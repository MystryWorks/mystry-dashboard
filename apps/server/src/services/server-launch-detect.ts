import fs from 'node:fs';
import path from 'node:path';
import type { CoreType } from '@mmd/shared';
import { assertSafeInstanceRoot, resolveSafePath } from '../utils/path.js';

export type ServerLaunchTarget = {
  value: string;
  coreType: CoreType;
};

export type ModLoaderScanBudget = {
  maxDepth: number;
  maxEntries: number;
  deadlineMs: number;
  signal?: AbortSignal;
};

class ModLoaderScanLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModLoaderScanLimitError';
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new Error('扫描已取消');
}

function isRegularFile(root: string, relativePath: string): boolean {
  try {
    const target = resolveSafePath(root, relativePath);
    const stat = fs.lstatSync(target);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

/** 探测实例根目录中的普通 jar 文件，不接受 symlink/junction。 */
export function detectJarFile(dir: string): string | null {
  assertSafeInstanceRoot(dir);
  const preferred = ['server.jar', 'paper.jar', 'fabric-server-launch.jar', 'minecraft_server.jar'];
  for (const name of preferred) {
    if (isRegularFile(dir, name)) return name;
  }

  const jars = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jar') && !entry.name.includes('installer'))
    .map((entry) => entry.name)
    .filter((name) => isRegularFile(dir, name));
  return jars[0] ?? null;
}

function modLoaderRelativeBase(kind: 'forge' | 'neoforge'): string {
  return kind === 'forge'
    ? 'libraries/net/minecraftforge/forge'
    : 'libraries/net/neoforged/neoforge';
}

/**
 * 异步、有界地查找 Forge/NeoForge args 启动文件。
 * 返回相对实例根目录的路径，并拒绝遍历 symlink/junction。
 */
export async function findModLoaderArgsFile(
  dir: string,
  kind: 'forge' | 'neoforge',
  budget: ModLoaderScanBudget,
): Promise<string | null> {
  const startedAt = Date.now();
  const relativeBase = modLoaderRelativeBase(kind);
  const base = resolveSafePath(dir, relativeBase);
  if (!fs.existsSync(base)) return null;
  assertSafeInstanceRoot(base);

  const preferredName = process.platform === 'win32' ? 'win_args.txt' : 'unix_args.txt';
  const fallback: string[] = [];
  let visited = 0;

  type QueueItem = { relative: string; depth: number };
  const queue: QueueItem[] = [{ relative: relativeBase, depth: 0 }];

  const checkBudget = (): void => {
    throwIfAborted(budget.signal);
    if (Date.now() - startedAt > budget.deadlineMs) {
      throw new ModLoaderScanLimitError('ModLoader 启动文件扫描超时');
    }
    if (visited >= budget.maxEntries) {
      throw new ModLoaderScanLimitError('ModLoader 启动文件扫描条目超限');
    }
  };

  while (queue.length > 0) {
    checkBudget();
    const currentItem = queue.pop()!;
    if (currentItem.depth > budget.maxDepth) {
      throw new ModLoaderScanLimitError('ModLoader 启动文件扫描深度超限');
    }

    const current = resolveSafePath(dir, currentItem.relative);
    assertSafeInstanceRoot(current);
    const entries = await fs.promises.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      checkBudget();
      visited += 1;
      const relative = path.join(currentItem.relative, entry.name);
      const full = resolveSafePath(dir, relative);
      const stat = await fs.promises.lstat(full);
      if (stat.isSymbolicLink()) {
        throw new Error('启动文件目录不能包含 symlink/junction');
      }
      if (stat.isDirectory()) {
        assertSafeInstanceRoot(full);
        queue.push({ relative, depth: currentItem.depth + 1 });
        continue;
      }
      if (!stat.isFile()) continue;
      const normalized = relative.replace(/\\/g, '/');
      if (entry.name === preferredName) return normalized;
      if (entry.name.endsWith('_args.txt')) fallback.push(normalized);
    }

    // 让出事件循环，避免长时间阻塞
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }

  return fallback[0] ?? null;
}

function inferJarCoreType(jarFile: string): CoreType {
  const normalized = jarFile.toLowerCase();
  if (normalized.includes('paper')) return 'paper';
  if (normalized.includes('fabric')) return 'fabric';
  if (normalized.includes('neoforge')) return 'neoforge';
  if (normalized.includes('forge')) return 'forge';
  if (normalized === 'server.jar' || normalized.includes('minecraft_server')) return 'vanilla';
  return 'custom';
}

/** 自动识别普通 jar 或现代 Forge/NeoForge args 启动目标。 */
export async function detectServerLaunchTarget(
  dir: string,
  budget: ModLoaderScanBudget,
): Promise<ServerLaunchTarget | null> {
  const neoForgeArgs = await findModLoaderArgsFile(dir, 'neoforge', budget);
  if (neoForgeArgs) return { value: `@args:${neoForgeArgs}`, coreType: 'neoforge' };

  const forgeArgs = await findModLoaderArgsFile(dir, 'forge', budget);
  if (forgeArgs) return { value: `@args:${forgeArgs}`, coreType: 'forge' };

  const jarFile = detectJarFile(dir);
  return jarFile ? { value: jarFile, coreType: inferJarCoreType(jarFile) } : null;
}

export function isModLoaderScanLimitError(error: unknown): error is ModLoaderScanLimitError {
  return error instanceof ModLoaderScanLimitError;
}
