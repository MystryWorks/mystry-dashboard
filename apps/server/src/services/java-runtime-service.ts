import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { JavaRuntimeInfo } from '@mmd/shared';
import { getDb, type JavaRuntimeRow } from '../db.js';
import { nowIso } from '../utils/path.js';
import { getMinecraftChildEnv } from '../utils/child-env.js';

/**
 * Java 运行时注册表：
 * - 候选路径只来自面板自身扫描（JAVA_HOME、常见安装目录），绝不接受请求提交的路径。
 * - 每个候选必须文件名是 java/java.exe，且执行 -version 输出能解析出版本号，
 *   两关都通过才写入注册表——确保“确定是 java”。
 * - 实例只能按 ID 引用注册表中的运行时；NULL 表示使用 PATH 中的 java。
 */

const execFileAsync = promisify(execFile);

/** 单个候选的 -version 验证超时；避免异常二进制拖慢扫描 */
const VERIFY_TIMEOUT_MS = 4_000;
/** 扫描结果缓存，避免前端频繁触发全盘扫描 */
const SCAN_CACHE_MS = 60_000;
/** 手动刷新允许的最短间隔，避免认证请求反复启动大量子进程 */
const FORCE_SCAN_COOLDOWN_MS = 30_000;

let lastScanAt = 0;
let lastForcedScanAt = 0;
let scanPromise: Promise<JavaRuntimeInfo[]> | null = null;

type JavaVersionRunner = (
  javaPath: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeout: number; windowsHide: boolean },
) => Promise<{ stdout: string; stderr: string }>;

const runJavaVersion: JavaVersionRunner = async (javaPath, args, options) => {
  const result = await execFileAsync(javaPath, args, options);
  return { stdout: String(result.stdout), stderr: String(result.stderr) };
};

function runtimeId(javaPath: string): string {
  const normalized = process.platform === 'win32' ? javaPath.toLowerCase() : javaPath;
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/** 验证候选确实是 Java：文件名必须是 java/java.exe，且 -version 输出可解析出版本号。 */
export async function verifyJavaExecutable(
  javaPath: string,
  run: JavaVersionRunner = runJavaVersion,
): Promise<{ version: string; majorVersion: number } | null> {
  const base = path.basename(javaPath).toLowerCase();
  if (base !== 'java' && base !== 'java.exe') return null;
  try {
    const { stdout, stderr } = await run(javaPath, ['-version'], {
      windowsHide: true,
      timeout: VERIFY_TIMEOUT_MS,
      // 候选可执行文件属于第三方程序，绝不能继承面板密钥和数据目录配置。
      env: getMinecraftChildEnv(),
    });
    const text = `${stderr}\n${stdout}`;
    const match = text.match(/version\s+"([^"]+)"/i) || text.match(/version\s+(\S+)/i);
    if (!match) return null;
    const version = match[1];
    // "1.8.0_202" → 8；"17.0.2" / "21" → 17 / 21
    const majorVersion = version.startsWith('1.')
      ? Number(version.split('.')[1])
      : Number(version.split('.')[0]);
    if (!Number.isInteger(majorVersion) || majorVersion <= 0) return null;
    return { version, majorVersion };
  } catch {
    return null;
  }
}

/** 收集候选路径（不去重、不验证，验证在 scan 中统一做）。 */
function collectCandidates(): Array<{ path: string; source: 'env' | 'scan' }> {
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  const candidates: Array<{ path: string; source: 'env' | 'scan' }> = [];

  const javaHome = process.env.JAVA_HOME;
  if (javaHome) {
    candidates.push({ path: path.join(javaHome, 'bin', exe), source: 'env' });
  }

  const roots: string[] = [];
  if (process.platform === 'win32') {
    for (const base of [process.env['ProgramFiles'], process.env['ProgramFiles(x86)']]) {
      if (!base) continue;
      for (const vendor of ['Java', 'Eclipse Adoptium', 'Microsoft', 'Zulu', 'Amazon Corretto', 'BellSoft', 'Semeru']) {
        roots.push(path.join(base, vendor));
      }
    }
  } else if (process.platform === 'darwin') {
    roots.push('/Library/Java/JavaVirtualMachines');
  } else {
    roots.push('/usr/lib/jvm', '/opt/java', '/usr/local/openjdk');
  }

  for (const root of roots) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const binDir =
        process.platform === 'darwin'
          ? path.join(root, entry.name, 'Contents', 'Home', 'bin')
          : path.join(root, entry.name, 'bin');
      candidates.push({ path: path.join(binDir, exe), source: 'scan' });
    }
  }

  return candidates;
}

function rowToInfo(row: JavaRuntimeRow): JavaRuntimeInfo {
  return {
    id: row.id,
    path: row.path,
    version: row.version,
    majorVersion: row.major_version,
    source: row.source,
    verifiedAt: row.verified_at,
    available: Boolean(row.available),
  };
}

export function listJavaRuntimes(): JavaRuntimeInfo[] {
  const rows = getDb()
    .prepare('SELECT * FROM java_runtimes ORDER BY available DESC, major_version DESC, path ASC')
    .all() as JavaRuntimeRow[];
  return rows.map(rowToInfo);
}

export function getJavaRuntime(id: string): JavaRuntimeRow | null {
  const row = getDb().prepare('SELECT * FROM java_runtimes WHERE id = ?').get(id) as
    | JavaRuntimeRow
    | undefined;
  return row ?? null;
}

function markRuntimeUnavailable(id: string): void {
  getDb().prepare('UPDATE java_runtimes SET available = 0 WHERE id = ?').run(id);
}

/**
 * 解析实例实际应执行的 Java。已绑定的条目会在每次执行前重新验证，
 * 避免扫描后路径被删除或替换时继续运行未知程序。
 */
export async function resolveJavaRuntimeCommand(javaRuntimeId: string | null | undefined): Promise<string> {
  if (javaRuntimeId === null || javaRuntimeId === undefined) return 'java';
  const runtime = getJavaRuntime(javaRuntimeId);
  if (!runtime || !runtime.available) {
    throw new Error('所选 Java 运行时不可用，请重新探测后再选择');
  }
  if (!fs.existsSync(runtime.path)) {
    markRuntimeUnavailable(runtime.id);
    throw new Error(`Java 运行时文件不存在：${runtime.path}，请重新探测后再选择`);
  }

  let realPath: string;
  try {
    realPath = fs.realpathSync(runtime.path);
  } catch {
    markRuntimeUnavailable(runtime.id);
    throw new Error(`无法解析 Java 运行时路径：${runtime.path}，请重新探测后再选择`);
  }
  if (runtimeId(realPath) !== runtime.id) {
    markRuntimeUnavailable(runtime.id);
    throw new Error('Java 运行时路径已变化，请重新探测后再选择');
  }

  const verified = await verifyJavaExecutable(realPath);
  if (!verified) {
    markRuntimeUnavailable(runtime.id);
    throw new Error('所选 Java 运行时无法通过验证，请重新探测后再选择');
  }
  getDb()
    .prepare(
      `UPDATE java_runtimes
       SET version = ?, major_version = ?, verified_at = ?, available = 1
       WHERE id = ?`,
    )
    .run(verified.version, verified.majorVersion, nowIso(), runtime.id);
  return realPath;
}

async function performScan(): Promise<JavaRuntimeInfo[]> {
  const verifiedRuntimes: Array<{
    id: string;
    path: string;
    version: string;
    majorVersion: number;
    source: 'env' | 'scan';
  }> = [];
  const seen = new Set<string>();
  for (const candidate of collectCandidates()) {
    if (!fs.existsSync(candidate.path)) continue;
    let realPath = candidate.path;
    try {
      realPath = fs.realpathSync(candidate.path);
    } catch {
      continue;
    }
    const dedupeKey = process.platform === 'win32' ? realPath.toLowerCase() : realPath;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const verified = await verifyJavaExecutable(realPath);
    if (!verified) continue;
    verifiedRuntimes.push({
      id: runtimeId(realPath),
      path: realPath,
      version: verified.version,
      majorVersion: verified.majorVersion,
      source: candidate.source,
    });
  }

  const db = getDb();
  const markAllUnavailable = db.prepare('UPDATE java_runtimes SET available = 0');
  const upsert = db.prepare(
    `INSERT INTO java_runtimes (id, path, version, major_version, source, verified_at, available)
     VALUES (?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(id) DO UPDATE SET
       path = excluded.path,
       version = excluded.version,
       major_version = excluded.major_version,
       source = excluded.source,
       verified_at = excluded.verified_at,
       available = 1`,
  );
  markAllUnavailable.run();
  const verifiedAt = nowIso();
  for (const runtime of verifiedRuntimes) {
    upsert.run(
      runtime.id,
      runtime.path,
      runtime.version,
      runtime.majorVersion,
      runtime.source,
      verifiedAt,
    );
  }
  lastScanAt = Date.now();
  return listJavaRuntimes();
}

/**
 * 扫描并验证候选，upsert 进注册表。最近一次扫描未发现的条目会标记不可用，
 * 保留实例绑定以便界面提示用户重新选择。
 */
export async function scanJavaRuntimes(force = false): Promise<JavaRuntimeInfo[]> {
  const now = Date.now();
  if (scanPromise) return scanPromise;
  if (!force && now - lastScanAt < SCAN_CACHE_MS) {
    return listJavaRuntimes();
  }
  if (force && now - lastForcedScanAt < FORCE_SCAN_COOLDOWN_MS) {
    return listJavaRuntimes();
  }
  if (force) lastForcedScanAt = now;
  scanPromise = performScan().finally(() => {
    scanPromise = null;
  });
  return scanPromise;
}
