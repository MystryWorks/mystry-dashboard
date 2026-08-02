import fs from 'node:fs';
import path from 'node:path';
import type { CoreType } from '@mmd/shared';
import { assertSafeInstanceRoot, resolveSafePath } from '../utils/path.js';

export type ServerLaunchTarget = {
  value: string;
  coreType: CoreType;
};

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

/**
 * 查找 Forge/NeoForge 的 args 启动文件（现代版本）。
 * 返回相对实例根目录的路径，并拒绝遍历 symlink/junction。
 */
export function findModLoaderArgsFile(
  dir: string,
  kind: 'forge' | 'neoforge',
): string | null {
  const relativeBase = kind === 'forge'
    ? 'libraries/net/minecraftforge/forge'
    : 'libraries/net/neoforged/neoforge';
  const base = resolveSafePath(dir, relativeBase);
  if (!fs.existsSync(base)) return null;
  assertSafeInstanceRoot(base);

  const preferredName = process.platform === 'win32' ? 'win_args.txt' : 'unix_args.txt';
  const fallback: string[] = [];
  const stack = [relativeBase];

  while (stack.length > 0) {
    const currentRelative = stack.pop()!;
    const current = resolveSafePath(dir, currentRelative);
    assertSafeInstanceRoot(current);
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const relative = path.join(currentRelative, entry.name);
      const full = resolveSafePath(dir, relative);
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) {
        throw new Error('启动文件目录不能包含 symlink/junction');
      }
      if (stat.isDirectory()) {
        assertSafeInstanceRoot(full);
        stack.push(relative);
        continue;
      }
      if (!stat.isFile()) continue;
      const normalized = relative.replace(/\\/g, '/');
      if (entry.name === preferredName) return normalized;
      if (entry.name.endsWith('_args.txt')) fallback.push(normalized);
    }
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
export function detectServerLaunchTarget(dir: string): ServerLaunchTarget | null {
  const neoForgeArgs = findModLoaderArgsFile(dir, 'neoforge');
  if (neoForgeArgs) return { value: `@args:${neoForgeArgs}`, coreType: 'neoforge' };

  const forgeArgs = findModLoaderArgsFile(dir, 'forge');
  if (forgeArgs) return { value: `@args:${forgeArgs}`, coreType: 'forge' };

  const jarFile = detectJarFile(dir);
  return jarFile ? { value: jarFile, coreType: inferJarCoreType(jarFile) } : null;
}
