import fs from 'node:fs';
import { inspectJvmArgFile, type CoreType, type DetectedJvmConfig } from '@mystry/shared';
import { resolveSafePath } from '../utils/path.js';

export const MAX_DETECTED_JVM_ARGS_BYTES = 64 * 1024;

function detectionError(message: string): DetectedJvmConfig {
  return {
    source: 'user_jvm_args.txt',
    raw: '',
    canonicalArgs: null,
    issues: [{ code: 'ARGFILE_READ_ERROR', severity: 'error', message }],
  };
}

export function jvmConfigFileFingerprint(root: string): string {
  const file = resolveSafePath(root, 'user_jvm_args.txt');
  try {
    const stat = fs.lstatSync(file);
    return `${stat.isFile() && !stat.isSymbolicLink()}:${stat.size}:${stat.mtimeMs}`;
  } catch {
    return 'missing';
  }
}

/** 只读取实例根目录中的普通 user_jvm_args.txt，不跟随链接。 */
export function detectJvmConfigFile(
  root: string,
  coreType?: CoreType | null,
): DetectedJvmConfig | undefined {
  const file = resolveSafePath(root, 'user_jvm_args.txt');
  if (!fs.existsSync(file)) return undefined;
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    return detectionError(`无法读取 user_jvm_args.txt：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    return detectionError('user_jvm_args.txt 必须是普通文件，不能是链接或特殊文件');
  }
  if (stat.size > MAX_DETECTED_JVM_ARGS_BYTES) {
    return detectionError('user_jvm_args.txt 超过 64 KiB，不能自动沿用');
  }
  try {
    return inspectJvmArgFile(fs.readFileSync(file, 'utf8'), { coreType });
  } catch (error) {
    return detectionError(`无法读取 user_jvm_args.txt：${error instanceof Error ? error.message : String(error)}`);
  }
}
