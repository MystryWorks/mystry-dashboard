import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { assertTextFileWithinLimit } from './file-service.js';
import { getInstanceDir, resolveSafePath } from '../utils/path.js';

export type PropertiesMap = Record<string, string>;

type PropertyEntryLine = {
  kind: 'entry';
  /** 原始行文本（不含换行） */
  raw: string;
  key: string;
  separator: '=' | ':';
  value: string;
};

type PropertyRawLine = {
  kind: 'raw';
  raw: string;
};

type PropertyLine = PropertyEntryLine | PropertyRawLine;

export type PropertiesDocument = {
  eol: '\n' | '\r\n';
  lines: PropertyLine[];
};

const DEFAULT_PROPERTIES: PropertiesMap = {
  'server-port': '25565',
  gamemode: 'survival',
  difficulty: 'normal',
  'max-players': '20',
  motd: 'A Minecraft Server',
  'online-mode': 'true',
};

function detectEol(content: string): '\n' | '\r\n' {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

function splitLines(content: string): string[] {
  if (content.length === 0) return [];
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const parts = normalized.split('\n');
  if (parts.length > 0 && parts[parts.length - 1] === '') {
    parts.pop();
  }
  return parts;
}

function unescapePropertyValue(value: string): string {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (char === '\\') {
      const next = value[index + 1];
      if (next === undefined) {
        result += char;
        continue;
      }
      if (next === 'u') {
        const hex = value.slice(index + 2, index + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          result += String.fromCharCode(Number.parseInt(hex, 16));
          index += 5;
          continue;
        }
      }
      if ('tnr\\f'.includes(next)) {
        const mapped: Record<string, string> = { t: '\t', n: '\n', r: '\r', f: '\f' };
        result += mapped[next] ?? next;
        index += 1;
        continue;
      }
      result += next;
      index += 1;
      continue;
    }
    result += char;
  }
  return result;
}

function parseEntryLine(raw: string): PropertyEntryLine | null {
  const trimmedStart = raw.trimStart();
  if (!trimmedStart || trimmedStart.startsWith('#') || trimmedStart.startsWith('!')) {
    return null;
  }

  let keyEnd = -1;
  let separator: '=' | ':' | null = null;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]!;
    if (char === '\\') {
      index += 1;
      continue;
    }
    if ((char === '=' || char === ':') && keyEnd === -1) {
      keyEnd = index;
      separator = char;
      break;
    }
  }
  if (keyEnd === -1 || !separator) return null;

  const key = raw.slice(0, keyEnd).trim();
  if (!key) return null;
  const value = unescapePropertyValue(raw.slice(keyEnd + 1).trimStart());
  return { kind: 'entry', raw, key, separator, value };
}

/** 将 logical 行（已处理续行）解析为文档行 */
function parseLogicalLines(logicalLines: string[]): PropertyLine[] {
  const lines: PropertyLine[] = [];
  for (const raw of logicalLines) {
    const entry = parseEntryLine(raw);
    lines.push(entry ?? { kind: 'raw', raw });
  }
  return lines;
}

function hasOddTrailingBackslash(value: string): boolean {
  let count = 0;
  for (let index = value.length - 1; index >= 0 && value[index] === '\\'; index -= 1) {
    count += 1;
  }
  return count % 2 === 1;
}

function joinLogicalLines(rawLines: string[]): string[] {
  const logical: string[] = [];
  let pending = '';
  for (const raw of rawLines) {
    pending = pending ? `${pending}${raw}` : raw;
    if (hasOddTrailingBackslash(pending)) {
      pending = pending.slice(0, -1);
      continue;
    }
    logical.push(pending);
    pending = '';
  }
  if (pending) logical.push(pending);
  return logical;
}

export function parsePropertiesDocument(content: string): PropertiesDocument {
  return {
    eol: detectEol(content),
    lines: parseLogicalLines(joinLogicalLines(splitLines(content))),
  };
}

/** 读取有效键值（重复键取最后一次定义） */
export function propertiesMapFromDocument(document: PropertiesDocument): PropertiesMap {
  const result: PropertiesMap = {};
  for (const line of document.lines) {
    if (line.kind === 'entry') {
      result[line.key] = line.value;
    }
  }
  return result;
}

/** 兼容旧接口：解析为有效键值映射 */
export function parseProperties(content: string): PropertiesMap {
  return propertiesMapFromDocument(parsePropertiesDocument(content));
}

function replaceEntryValue(line: PropertyEntryLine, value: string): PropertyEntryLine {
  // 与 parseEntryLine 相同的扫描方式定位分隔符，跳过 key 中反斜杠转义的 \=。
  let separatorIndex = -1;
  for (let index = 0; index < line.raw.length; index += 1) {
    const char = line.raw[index]!;
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (char === line.separator) {
      separatorIndex = index;
      break;
    }
  }
  const prefix = separatorIndex === -1 ? line.raw : line.raw.slice(0, separatorIndex + 1);
  return {
    ...line,
    raw: `${prefix}${value}`,
    value: unescapePropertyValue(value),
  };
}

/** Java properties 转义：反斜杠与 \t \r \n \f 必须转义，否则写出后会被当作语法而非值。 */
function escapePropertyValue(value: string): string {
  return value.replace(/[\\\t\r\n\f]/g, (char) => {
    const mapped: Record<string, string> = {
      '\\': '\\\\',
      '\t': '\\t',
      '\r': '\\r',
      '\n': '\\n',
      '\f': '\\f',
    };
    return mapped[char] ?? char;
  });
}

/**
 * 将引导表单/高级选项提交的键值合并进文档，仅修改每个 key 的最后一次定义。
 */
export function applyPropertiesPatch(document: PropertiesDocument, patch: PropertiesMap): PropertiesDocument {
  const lastIndexByKey = new Map<string, number>();
  document.lines.forEach((line, index) => {
    if (line.kind === 'entry') lastIndexByKey.set(line.key, index);
  });

  const nextLines = document.lines.map((line) => ({ ...line })) as PropertyLine[];
  const appended: PropertyLine[] = [];

  for (const [key, value] of Object.entries(patch)) {
    const escapedValue = escapePropertyValue(value);
    const lastIndex = lastIndexByKey.get(key);
    if (lastIndex === undefined) {
      appended.push({
        kind: 'entry',
        raw: `${key}=${escapedValue}`,
        key,
        separator: '=',
        value,
      });
      continue;
    }
    const current = nextLines[lastIndex];
    if (current?.kind === 'entry') {
      nextLines[lastIndex] = replaceEntryValue(current, escapedValue);
    }
  }

  return {
    eol: document.eol,
    lines: [...nextLines, ...appended],
  };
}

export function stringifyPropertiesDocument(document: PropertiesDocument): string {
  const body = document.lines.map((line) => line.raw).join(document.eol);
  if (body.length === 0) return '';
  return `${body}${document.eol}`;
}

/** 新建文件时使用（无历史注释/顺序可保留） */
export function stringifyProperties(map: PropertiesMap): string {
  const lines = Object.entries(map).map(([key, value]) => `${key}=${value}`);
  return `${lines.join('\n')}\n`;
}

function assertMutablePropertiesFile(instanceId: string, file: string): void {
  assertTextFileWithinLimit(instanceId, 'server.properties');
  if (!fs.existsSync(file)) return;
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error('server.properties 不是普通文件');
  }
}

function writeFileAtomic(target: string, content: string): void {
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temp = path.join(
    dir,
    `.${path.basename(target)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`,
  );
  const fd = fs.openSync(temp, 'wx', 0o600);
  try {
    fs.writeSync(fd, Buffer.from(content, 'utf8'));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    // 直接 rename 覆盖：POSIX 原子替换，Windows 上 libuv 使用
    // MOVEFILE_REPLACE_EXISTING。不再先删除原文件，rename 失败时原文件仍保留。
    fs.renameSync(temp, target);
  } catch (error) {
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      /* 忽略清理失败 */
    }
    throw error;
  }
}

export function readServerProperties(instanceId: string): PropertiesMap {
  const root = getInstanceDir(instanceId);
  const file = resolveSafePath(root, 'server.properties');
  if (!fs.existsSync(file)) {
    return { ...DEFAULT_PROPERTIES };
  }
  assertMutablePropertiesFile(instanceId, file);
  return parseProperties(fs.readFileSync(file, 'utf8'));
}

/** 首次启动前写入面板默认配置；已有 server.properties 保持不变。 */
export function ensureServerPropertiesDefaults(instanceId: string): void {
  const root = getInstanceDir(instanceId);
  const file = resolveSafePath(root, 'server.properties');
  if (fs.existsSync(file)) return;
  writeServerProperties(instanceId, {});
}

export function previewServerPropertiesWrite(instanceId: string, patch: PropertiesMap): string {
  const root = getInstanceDir(instanceId);
  const file = resolveSafePath(root, 'server.properties');
  // 默认文档不混入 patch：先解析纯默认值，再统一经 applyPropertiesPatch 转义应用，
  // 避免未转义值（换行、尾随反斜杠）在解析阶段被拆成额外属性或吞并下一行。
  const baseDocument = fs.existsSync(file)
    ? parsePropertiesDocument(fs.readFileSync(file, 'utf8'))
    : parsePropertiesDocument(stringifyProperties({ ...DEFAULT_PROPERTIES }));
  return stringifyPropertiesDocument(applyPropertiesPatch(baseDocument, patch));
}

export function writeServerProperties(instanceId: string, patch: PropertiesMap): void {
  const root = getInstanceDir(instanceId);
  const file = resolveSafePath(root, 'server.properties');
  assertMutablePropertiesFile(instanceId, file);

  // 默认文档不混入 patch：先解析纯默认值，再统一经 applyPropertiesPatch 转义应用，
  // 避免未转义值（换行、尾随反斜杠）在解析阶段被拆成额外属性或吞并下一行。
  const baseDocument = fs.existsSync(file)
    ? parsePropertiesDocument(fs.readFileSync(file, 'utf8'))
    : parsePropertiesDocument(stringifyProperties({ ...DEFAULT_PROPERTIES }));
  const nextContent = stringifyPropertiesDocument(applyPropertiesPatch(baseDocument, patch));
  writeFileAtomic(file, nextContent);
}

export function ensureEula(instanceId: string, accept: boolean): void {
  if (!accept) return;
  const root = getInstanceDir(instanceId);
  fs.writeFileSync(resolveSafePath(root, 'eula.txt'), 'eula=true\n', 'utf8');
}
