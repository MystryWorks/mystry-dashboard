import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { JavaDetectResult } from '@mystry/shared';
import { getMinecraftChildEnv } from '../utils/child-env.js';

const execFileAsync = promisify(execFile);

export type JavaDetectRunner = (
  file: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeout: number; windowsHide: boolean },
) => Promise<{ stdout: string; stderr: string }>;

const defaultRunner: JavaDetectRunner = async (file, args, options) => {
  const result = await execFileAsync(file, args, options);
  return { stdout: String(result.stdout), stderr: String(result.stderr) };
};

/** 探测 PATH 中的 java；子进程环境脱敏，不继承面板密钥。 */
export async function detectJava(run: JavaDetectRunner = defaultRunner): Promise<JavaDetectResult> {
  try {
    const { stdout, stderr } = await run('java', ['-version'], {
      windowsHide: true,
      timeout: 8000,
      env: getMinecraftChildEnv(),
    });
    const text = `${stderr}\n${stdout}`;
    const match = text.match(/version\s+"([^"]+)"/i) || text.match(/version\s+(\S+)/i);
    const version = match?.[1] ?? null;
    const majorVersion = version
      ? Number(version.startsWith('1.') ? version.split('.')[1] : version.split('.')[0])
      : null;
    return {
      available: true,
      version,
      majorVersion: Number.isInteger(majorVersion) && Number(majorVersion) > 0
        ? majorVersion
        : null,
    };
  } catch {
    return { available: false, version: null, majorVersion: null };
  }
}
