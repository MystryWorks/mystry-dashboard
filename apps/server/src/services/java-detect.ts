import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { JavaDetectResult } from '@mmd/shared';

const execFileAsync = promisify(execFile);

export async function detectJava(): Promise<JavaDetectResult> {
  try {
    const { stdout, stderr } = await execFileAsync('java', ['-version'], {
      windowsHide: true,
      timeout: 8000,
    });
    const text = `${stderr}\n${stdout}`;
    const match = text.match(/version\s+"([^"]+)"/i) || text.match(/version\s+(\S+)/i);
    return { available: true, version: match?.[1] ?? null };
  } catch {
    return { available: false, version: null };
  }
}
