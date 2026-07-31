/**
 * 控制台日志着色：按 ECMA-48 / ISO 6429 SGR 标准色映射常见级别。
 * INFO=绿、WARN=黄、ERROR=红（使用亮色变体，便于深色终端阅读）。
 */

const RESET = '\x1b[0m';

const ANSI = {
  info: '\x1b[92m', // bright green
  warn: '\x1b[93m', // bright yellow
  error: '\x1b[91m', // bright red
  debug: '\x1b[96m', // bright cyan
  fatal: '\x1b[95m', // bright magenta
} as const;

const HAS_ANSI = /\x1b\[/;

/** 匹配 Minecraft / Log4j 常见级别写法，例如 [Server thread/INFO]、/WARN] */
const LEVEL_RE =
  /(?:^|[^A-Za-z0-9_])(?:\/)?(FATAL|ERROR|SEVERE|WARN(?:ING)?|INFO|DEBUG|TRACE)(?=[\]:\s])/i;

export type ConsoleColorizeState = {
  pending: string;
};

export function createConsoleColorizeState(): ConsoleColorizeState {
  return { pending: '' };
}

function colorForLevel(level: string): string | null {
  switch (level.toUpperCase()) {
    case 'FATAL':
      return ANSI.fatal;
    case 'ERROR':
    case 'SEVERE':
      return ANSI.error;
    case 'WARN':
    case 'WARNING':
      return ANSI.warn;
    case 'INFO':
      return ANSI.info;
    case 'DEBUG':
    case 'TRACE':
      return ANSI.debug;
    default:
      return null;
  }
}

/** 为单行日志附加 ANSI 颜色；已含转义序列的行原样返回。 */
export function colorizeConsoleLine(line: string): string {
  if (!line || HAS_ANSI.test(line)) return line;

  // 面板自身提示
  if (line.startsWith('[错误]')) return `${ANSI.error}${line}${RESET}`;
  if (line.startsWith('[面板]')) return `${ANSI.debug}${line}${RESET}`;

  const match = LEVEL_RE.exec(line);
  if (!match?.[1]) return line;
  const color = colorForLevel(match[1]);
  if (!color) return line;
  return `${color}${line}${RESET}`;
}

/**
 * 流式着色：按完整行着色，未结束的残片留在 state.pending。
 * 保留原始换行形态（\n 或 \r\n）。
 */
export function colorizeConsoleStream(chunk: string, state: ConsoleColorizeState): string {
  const text = state.pending + chunk;
  let out = '';
  let start = 0;

  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) !== 10 /* \n */) continue;
    const rawLine = text.slice(start, i);
    const hadCr = rawLine.endsWith('\r');
    const content = hadCr ? rawLine.slice(0, -1) : rawLine;
    out += colorizeConsoleLine(content) + (hadCr ? '\r\n' : '\n');
    start = i + 1;
  }

  state.pending = text.slice(start);
  return out;
}

/** 连接结束或历史写完时，刷新未完成的残片。 */
export function flushConsoleColorize(state: ConsoleColorizeState): string {
  if (!state.pending) return '';
  const out = colorizeConsoleLine(state.pending);
  state.pending = '';
  return out;
}
