import type { CoreType } from './index.js';

export type JvmPresetId = 'compatibility' | 'g1-balanced' | 'paper-aikar' | 'custom';

export type JvmValidationIssue = {
  code: string;
  severity: 'error' | 'warning';
  message: string;
};

export type DetectedJvmConfig = {
  source: 'user_jvm_args.txt';
  raw: string;
  canonicalArgs: string | null;
  issues: JvmValidationIssue[];
};

export type JvmPresetDefinition = {
  id: Exclude<JvmPresetId, 'custom'>;
  label: string;
  description: string;
  version: string;
  supportedCoreTypes: readonly CoreType[] | null;
  supportedJavaMajors: readonly number[] | null;
  sourceUrl: string | null;
  reviewedAt: string;
  args: readonly string[];
};

export type JvmValidationContext = {
  coreType?: CoreType | null;
  javaMajor?: number | null;
  totalMemoryMiB?: number | null;
};

export type ParsedJvmConfig = {
  raw: string;
  args: string[];
  xmsMiB: number | null;
  xmxMiB: number | null;
  presetId: JvmPresetId;
  extraArgs: string;
  canonicalArgs: string | null;
  issues: JvmValidationIssue[];
};

const G1_BALANCED_ARGS = [
  '-XX:+UseG1GC',
  '-XX:+ParallelRefProcEnabled',
  '-XX:MaxGCPauseMillis=200',
] as const;

const PAPER_AIKAR_ARGS = [
  '-XX:+UseG1GC',
  '-XX:+ParallelRefProcEnabled',
  '-XX:MaxGCPauseMillis=200',
  '-XX:+UnlockExperimentalVMOptions',
  '-XX:+DisableExplicitGC',
  '-XX:+AlwaysPreTouch',
  '-XX:G1NewSizePercent=30',
  '-XX:G1MaxNewSizePercent=40',
  '-XX:G1HeapRegionSize=8M',
  '-XX:G1ReservePercent=20',
  '-XX:G1HeapWastePercent=5',
  '-XX:G1MixedGCCountTarget=4',
  '-XX:InitiatingHeapOccupancyPercent=15',
  '-XX:G1MixedGCLiveThresholdPercent=90',
  '-XX:G1RSetUpdatingPauseTimePercent=5',
  '-XX:SurvivorRatio=32',
  '-XX:+PerfDisableSharedMem',
  '-XX:MaxTenuringThreshold=1',
  '-Dusing.aikars.flags=https://mcflags.emc.gs',
  '-Daikars.new.flags=true',
] as const;

export const JVM_PRESETS: readonly JvmPresetDefinition[] = [
  {
    id: 'compatibility',
    label: '兼容优先',
    description: '只设置初始和最大内存，不附加 GC 调优参数。',
    version: '1',
    supportedCoreTypes: null,
    supportedJavaMajors: null,
    sourceUrl: null,
    reviewedAt: '2026-08-11',
    args: [],
  },
  {
    id: 'g1-balanced',
    label: 'G1 均衡',
    description: '使用保守的 G1 暂停目标，适合常规服务端。',
    version: '1',
    supportedCoreTypes: null,
    supportedJavaMajors: [8, 17, 21],
    sourceUrl: 'https://docs.oracle.com/en/java/javase/22/gctuning/hotspot-virtual-machine-garbage-collection-tuning-guide.pdf',
    reviewedAt: '2026-08-11',
    args: G1_BALANCED_ARGS,
  },
  {
    id: 'paper-aikar',
    label: 'Paper Aikar',
    description: 'PaperMC 官方 Aikar 参数；建议至少分配 6 GiB。',
    version: 'papermc-2026-08-11',
    supportedCoreTypes: ['paper'],
    supportedJavaMajors: [8, 17, 21],
    sourceUrl: 'https://docs.papermc.io/paper/aikars-flags/',
    reviewedAt: '2026-08-11',
    args: PAPER_AIKAR_ARGS,
  },
] as const;

const GC_SELECTOR_PATTERN = /^-XX:[+-]Use(?:G1|Parallel|Serial|Z|Shenandoah|Epsilon|ConcMarkSweep)GC$/;

const PANEL_OWNED_ARGS = new Set([
  '-jar',
  '-cp',
  '-classpath',
  '--class-path',
  '-m',
  '--module',
  'nogui',
  '--nogui',
  '--disable-@files',
  'java',
  'java.exe',
  'javaw',
  'javaw.exe',
]);

function issue(
  code: string,
  severity: JvmValidationIssue['severity'],
  message: string,
): JvmValidationIssue {
  return { code, severity, message };
}

function parseJvmTokens(value: string, unescapeQuotedBackslashes: boolean): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let tokenStarted = false;

  const pushCurrent = () => {
    if (!tokenStarted) return;
    args.push(current);
    current = '';
    tokenStarted = false;
  };

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (quote) {
      if (character === quote) {
        quote = null;
        tokenStarted = true;
        continue;
      }
      if (
        character === '\\'
        && (value[index + 1] === quote || (unescapeQuotedBackslashes && value[index + 1] === '\\'))
      ) {
        current += value[index + 1]!;
        tokenStarted = true;
        index += 1;
        continue;
      }
      current += character;
      tokenStarted = true;
      continue;
    }
    if (/\s/.test(character)) {
      pushCurrent();
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      tokenStarted = true;
      continue;
    }
    if (character === '\\') {
      const next = value[index + 1];
      if (next !== undefined && (/\s/.test(next) || next === '"' || next === "'")) {
        current += next;
        tokenStarted = true;
        index += 1;
        continue;
      }
    }
    current += character;
    tokenStarted = true;
  }

  if (quote) throw new Error('JVM 参数包含未闭合的引号');
  pushCurrent();
  return args;
}

/** 把用户输入的 JVM 参数字符串解析为可直接传给 spawn 的参数数组。 */
export function parseJvmArgs(value: string): string[] {
  return parseJvmTokens(value, false);
}

/** 按 Java 启动器规则解析 @argfile，并对未闭合引号使用更严格的面板校验。 */
export function parseJvmArgFile(value: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let tokenStarted = false;
  let comment = false;

  const pushCurrent = () => {
    if (!tokenStarted) return;
    args.push(current);
    current = '';
    tokenStarted = false;
  };

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (comment) {
      if (character === '\n' || character === '\r') comment = false;
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = null;
        tokenStarted = true;
        continue;
      }
      if (character === '\r' || character === '\n') continue;
      if (character === '\\') {
        const next = value[index + 1];
        if (next === '\r' || next === '\n') {
          if (next === '\r' && value[index + 2] === '\n') index += 1;
          index += 1;
          while (/[ \t]/.test(value[index + 1] ?? '')) index += 1;
          continue;
        }
        if (next !== undefined) {
          current += next === 'n'
            ? '\n'
            : next === 'r'
              ? '\r'
              : next === 't'
                ? '\t'
                : next === 'f'
                  ? '\f'
                  : next;
          tokenStarted = true;
          index += 1;
          continue;
        }
      }
      current += character;
      tokenStarted = true;
      continue;
    }
    if (character === '#') {
      pushCurrent();
      comment = true;
      continue;
    }
    if (/\s/.test(character)) {
      pushCurrent();
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      tokenStarted = true;
      continue;
    }
    if (character === '\\') {
      const next = value[index + 1];
      if (next === '\r' || next === '\n') {
        if (next === '\r' && value[index + 2] === '\n') index += 1;
        index += 1;
        while (/[ \t]/.test(value[index + 1] ?? '')) index += 1;
        continue;
      }
      if (next !== undefined) {
        current += next;
        tokenStarted = true;
        index += 1;
        continue;
      }
    }
    current += character;
    tokenStarted = true;
  }
  if (quote) throw new Error('JVM 参数包含未闭合的引号');
  pushCurrent();
  return args;
}

/** 将参数数组规范化成面板可再次解析的单行字符串。 */
export function serializeJvmArgs(args: readonly string[]): string {
  return args
    .map((argument) => {
      if (argument === '') return '""';
      return argument.replace(/([\s"'])/g, '\\$1');
    })
    .join(' ');
}

/** 把参数数组序列化为 Java @argfile，每行严格对应一个参数。 */
export function serializeJvmArgFile(args: readonly string[]): string {
  return args
    .map((argument) => `"${argument
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
      .replace(/\f/g, '\\f')}"`)
    .join('\n');
}

function parseMemoryMiB(argument: string, kind: 's' | 'x'): number | null {
  const match = new RegExp(`^-Xm${kind}(\\d+)([kKmMgGtT]?)$`).exec(argument);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = unit === 'k'
    ? 1 / 1024
    : unit === 'g'
      ? 1024
      : unit === 't'
        ? 1024 * 1024
        : unit === 'm'
          ? 1
          : 1 / (1024 * 1024);
  const result = amount * multiplier;
  return Number.isFinite(result) && result > 0 ? result : null;
}

function presetById(id: JvmPresetId): JvmPresetDefinition | null {
  return JVM_PRESETS.find((preset) => preset.id === id) ?? null;
}

function startsWithArgs(value: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length <= value.length && prefix.every((argument, index) => value[index] === argument);
}

function detectPreset(nonMemoryArgs: readonly string[]): {
  presetId: JvmPresetId;
  extraArgs: string[];
} {
  for (const preset of [...JVM_PRESETS].sort((left, right) => right.args.length - left.args.length)) {
    if (preset.args.length > 0 && startsWithArgs(nonMemoryArgs, preset.args)) {
      return { presetId: preset.id, extraArgs: nonMemoryArgs.slice(preset.args.length) };
    }
  }
  if (nonMemoryArgs.length === 0) return { presetId: 'compatibility', extraArgs: [] };
  return { presetId: 'custom', extraArgs: [...nonMemoryArgs] };
}

export function recommendedMaxMemoryMiB(totalMemoryMiB: number | null | undefined): number {
  if (!totalMemoryMiB || !Number.isFinite(totalMemoryMiB) || totalMemoryMiB <= 0) return 2048;
  const roundedQuarter = Math.floor((totalMemoryMiB * 0.25) / 512) * 512;
  const safeCap = Math.floor((totalMemoryMiB - 2048) / 512) * 512;
  const usualRecommendation = Math.max(2048, Math.min(8192, roundedQuarter));
  return Math.max(1024, Math.min(usualRecommendation, Math.max(1024, safeCap)));
}

export function automaticInitialMemoryMiB(presetId: JvmPresetId, maximumMiB: number): number {
  return presetId === 'paper-aikar' ? maximumMiB : Math.min(1024, maximumMiB);
}

export function validateJvmArgs(
  value: string,
  context: JvmValidationContext = {},
): JvmValidationIssue[] {
  const issues: JvmValidationIssue[] = [];
  if (value.length > 8192) {
    issues.push(issue('ARGS_TOO_LONG', 'error', 'JVM 参数不能超过 8192 个字符'));
  }
  let args: string[];
  try {
    args = parseJvmArgs(value);
  } catch (error) {
    return [issue('PARSE_ERROR', 'error', error instanceof Error ? error.message : String(error))];
  }

  const xmsArgs = args.filter((argument) => argument.startsWith('-Xms'));
  const xmxArgs = args.filter((argument) => argument.startsWith('-Xmx'));
  if (xmsArgs.length !== 1) {
    issues.push(issue('XMS_COUNT', 'error', 'JVM 参数必须且只能包含一个 -Xms 初始内存参数'));
  }
  if (xmxArgs.length !== 1) {
    issues.push(issue('XMX_COUNT', 'error', 'JVM 参数必须且只能包含一个 -Xmx 最大内存参数'));
  }

  const xmsMiB = xmsArgs.length === 1 ? parseMemoryMiB(xmsArgs[0]!, 's') : null;
  const xmxMiB = xmxArgs.length === 1 ? parseMemoryMiB(xmxArgs[0]!, 'x') : null;
  if (xmsArgs.length === 1 && xmsMiB === null) {
    issues.push(issue('XMS_FORMAT', 'error', '初始内存格式无效，请使用例如 -Xms1G 或 -Xms1024M'));
  }
  if (xmxArgs.length === 1 && xmxMiB === null) {
    issues.push(issue('XMX_FORMAT', 'error', '最大内存格式无效，请使用例如 -Xmx4G 或 -Xmx4096M'));
  }
  if (xmsMiB !== null && xmxMiB !== null && xmsMiB > xmxMiB) {
    issues.push(issue('MEMORY_ORDER', 'error', '初始内存不能大于最大内存'));
  }
  if (xmxMiB !== null && context.totalMemoryMiB && xmxMiB > context.totalMemoryMiB - 2048) {
    issues.push(issue('MEMORY_HIGH', 'warning', '最大内存接近或超过主机可安全分配范围，请为系统和面板保留内存'));
  }

  for (const argument of args) {
    const normalizedArgument = argument.toLowerCase();
    if (
      PANEL_OWNED_ARGS.has(normalizedArgument)
      || argument.startsWith('@')
      || normalizedArgument.startsWith('--class-path=')
      || normalizedArgument.startsWith('--module=')
    ) {
      issues.push(issue('PANEL_OWNED_ARGUMENT', 'error', `参数 ${argument} 由面板管理，不能写入 JVM 参数`));
    }
  }
  const gcSelectors = args.filter((argument) => GC_SELECTOR_PATTERN.test(argument));
  if (gcSelectors.length > 1) {
    issues.push(issue('GC_CONFLICT', 'error', '垃圾回收器参数不能重复，也不能同时选择多个回收器'));
  }

  const nonMemoryArgs = args.filter((argument) => !argument.startsWith('-Xms') && !argument.startsWith('-Xmx'));
  const detected = detectPreset(nonMemoryArgs);
  const preset = presetById(detected.presetId);
  if (preset?.supportedCoreTypes && context.coreType && !preset.supportedCoreTypes.includes(context.coreType)) {
    issues.push(issue('PRESET_CORE_MISMATCH', 'error', `${preset.label} 仅适用于 ${preset.supportedCoreTypes.join('/')} 核心`));
  }
  if (preset?.supportedJavaMajors) {
    if (context.javaMajor == null) {
      issues.push(issue('JAVA_MAJOR_UNKNOWN', 'warning', `${preset.label} 尚未确认所选 Java 版本是否兼容`));
    } else if (!preset.supportedJavaMajors.includes(context.javaMajor)) {
      issues.push(issue('PRESET_JAVA_MISMATCH', 'warning', `${preset.label} 未验证支持 Java ${context.javaMajor}`));
    }
  }
  if (detected.presetId === 'paper-aikar' && xmsMiB !== null && xmxMiB !== null) {
    if (xmsMiB !== xmxMiB) {
      issues.push(issue('PAPER_MEMORY_MISMATCH', 'error', 'Paper Aikar 方案要求 Xms 与 Xmx 相同'));
    }
    if (xmxMiB < 6144) {
      issues.push(issue('PAPER_MEMORY_LOW', 'warning', 'PaperMC 建议为 Aikar 参数分配至少 6 GiB 内存'));
    }
  }
  return issues;
}

export function inspectJvmArgs(
  value: string,
  context: JvmValidationContext = {},
): ParsedJvmConfig {
  let args: string[] = [];
  try {
    args = parseJvmArgs(value);
  } catch {
    return {
      raw: value,
      args: [],
      xmsMiB: null,
      xmxMiB: null,
      presetId: 'custom',
      extraArgs: value,
      canonicalArgs: null,
      issues: validateJvmArgs(value, context),
    };
  }
  const xmsArg = args.find((argument) => argument.startsWith('-Xms'));
  const xmxArg = args.find((argument) => argument.startsWith('-Xmx'));
  const nonMemoryArgs = args.filter((argument) => !argument.startsWith('-Xms') && !argument.startsWith('-Xmx'));
  const detected = detectPreset(nonMemoryArgs);
  const issues = validateJvmArgs(value, context);
  return {
    raw: value,
    args,
    xmsMiB: xmsArg ? parseMemoryMiB(xmsArg, 's') : null,
    xmxMiB: xmxArg ? parseMemoryMiB(xmxArg, 'x') : null,
    presetId: detected.presetId,
    extraArgs: serializeJvmArgs(detected.extraArgs),
    canonicalArgs: issues.some((item) => item.severity === 'error') ? null : serializeJvmArgs(args),
    issues,
  };
}

export function inspectJvmArgFile(
  raw: string,
  context: JvmValidationContext = {},
): DetectedJvmConfig {
  try {
    const args = parseJvmArgFile(raw);
    const canonical = serializeJvmArgs(args);
    const issues = validateJvmArgs(canonical, context);
    return {
      source: 'user_jvm_args.txt',
      raw,
      canonicalArgs: issues.some((item) => item.severity === 'error') ? null : canonical,
      issues,
    };
  } catch (error) {
    return {
      source: 'user_jvm_args.txt',
      raw,
      canonicalArgs: null,
      issues: [issue('ARGFILE_PARSE_ERROR', 'error', error instanceof Error ? error.message : String(error))],
    };
  }
}

export function buildJvmArgs(input: {
  xmsMiB: number;
  xmxMiB: number;
  presetId: JvmPresetId;
  extraArgs?: string;
}): string {
  const preset = presetById(input.presetId);
  const extra = input.extraArgs?.trim() ? parseJvmArgs(input.extraArgs) : [];
  return serializeJvmArgs([
    `-Xms${Math.round(input.xmsMiB)}M`,
    `-Xmx${Math.round(input.xmxMiB)}M`,
    ...(preset?.args ?? []),
    ...extra,
  ]);
}

export function firstJvmValidationError(
  value: string,
  context: JvmValidationContext = {},
): string | null {
  return validateJvmArgs(value, context).find((item) => item.severity === 'error')?.message ?? null;
}
