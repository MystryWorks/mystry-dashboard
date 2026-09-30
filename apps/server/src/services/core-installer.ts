import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { config } from '../config.js';
import { resolveSafePath } from '../utils/path.js';
import { parseJvmArgs, serializeJvmArgFile } from '../utils/jvm-args.js';
import { getMinecraftChildEnv } from '../utils/child-env.js';
import { abortError } from './core-utils.js';

const INSTALLER_MAX_ATTEMPTS = 2;

class InstallerProcessError extends Error {
  constructor(
    readonly exitCode: number | null,
    readonly output: string,
  ) {
    super(`Installer 退出码 ${exitCode ?? '未知'}\n${output}`);
    this.name = 'InstallerProcessError';
  }
}

export function isRetryableInstallerFailure(output: string): boolean {
  return /These libraries failed to download\. Try again\./i.test(output)
    || /(?:SocketTimeoutException|ConnectException|UnknownHostException|SSL(?:Handshake)?Exception)/i.test(output);
}

export function summarizeInstallerDownloadFailure(output: string, attempts: number): string {
  const failedBlock = output.match(
    /These libraries failed to download\. Try again\.\s*([\s\S]*?)\s*There was an error during installation/i,
  )?.[1];
  const failedLibraries = failedBlock
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3);
  const failedUrl = output.match(/Failed to establish connection to (https?:\/\/\S+)/i)?.[1];
  let failedHost = '';
  if (failedUrl) {
    try {
      failedHost = new URL(failedUrl).host;
    } catch {
      // URL 只用于优化错误提示，解析失败不影响任务收尾。
    }
  }

  let reason = '连接失败';
  if (/SocketTimeoutException:\s*Read timed out/i.test(output)) reason = '读取超时';
  else if (/UnknownHostException/i.test(output)) reason = '域名解析失败';
  else if (/SSL(?:Handshake)?Exception/i.test(output)) reason = 'TLS 连接失败';

  const libraryText = failedLibraries?.length
    ? `失败依赖：${failedLibraries.join('、')}；`
    : '';
  const hostText = failedHost ? `${failedHost} ${reason}` : reason;
  const retryText = attempts > 1 ? `已自动重试 ${attempts - 1} 次，` : '';
  return `Installer 下载依赖失败（${retryText}${hostText}）。${libraryText}请检查网络、代理或防火墙后重新部署。`;
}

type InstallerProgressState = {
  progress: number;
  completedDownloads: number;
};

function installerArtifactName(urlText: string): string {
  try {
    const pathname = new URL(urlText).pathname;
    return decodeURIComponent(pathname.slice(pathname.lastIndexOf('/') + 1)) || '依赖文件';
  } catch {
    return '依赖文件';
  }
}

function reportInstallerLine(
  line: string,
  state: InstallerProgressState,
  report?: (progress: number, message: string) => void,
): void {
  if (!report) return;
  const downloadUrl = line.match(/Downloading (?:library )?from (https?:\/\/\S+)/i)?.[1];
  if (downloadUrl) {
    state.progress = Math.min(83, state.progress + 1);
    report(state.progress, `Installer 正在下载 ${installerArtifactName(downloadUrl)}…`);
    return;
  }
  if (/Download completed:/i.test(line)) {
    state.completedDownloads += 1;
    state.progress = Math.min(84, Math.max(state.progress, 60 + state.completedDownloads));
    report(state.progress, `Installer 已完成 ${state.completedDownloads} 个下载…`);
    return;
  }
  if (/Failed to establish connection to /i.test(line)) {
    report(state.progress, 'Installer 下载遇到网络问题，正在继续处理…');
  }
}

function runInstallerAttempt(
  installerJar: string,
  cwd: string,
  javaCommand: string,
  signal: AbortSignal,
  progressState: InstallerProgressState,
  report?: (progress: number, message: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError(signal));
      return;
    }
    const child = spawn(javaCommand, ['-jar', installerJar, '--installServer'], {
      cwd,
      env: getMinecraftChildEnv(),
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = Buffer.alloc(0);
    let aborted = false;
    let settled = false;
    let forceTimer: NodeJS.Timeout | null = null;
    let pendingLine = '';
    const appendOutput = (chunk: Buffer) => {
      output = Buffer.concat([output, chunk]);
      if (output.length > config.maxInstallerOutputBytes) {
        output = output.subarray(output.length - config.maxInstallerOutputBytes);
      }
      pendingLine += chunk.toString('utf8');
      const lines = pendingLine.split(/\r?\n/);
      pendingLine = lines.pop() ?? '';
      for (const line of lines) reportInstallerLine(line, progressState, report);
    };
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
      if (forceTimer) {
        clearTimeout(forceTimer);
        forceTimer = null;
      }
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const killProcessTree = (force: boolean) => {
      const pid = child.pid;
      if (!pid) return;
      if (process.platform === 'win32') {
        // 只针对 installer 的 PID 杀进程树，不能使用面板自身的 PID。
        const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
        killer.once('error', () => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* 子进程可能已经退出 */
          }
        });
        return;
      }

      try {
        process.kill(-pid, force ? 'SIGKILL' : 'SIGTERM');
      } catch {
        try {
          child.kill(force ? 'SIGKILL' : 'SIGTERM');
        } catch {
          /* 子进程可能已经退出 */
        }
      }
    };
    const onAbort = () => {
      if (aborted) return;
      aborted = true;
      killProcessTree(false);
      forceTimer = setTimeout(() => {
        killProcessTree(true);
        // 某些平台在强制杀进程后不会再发送 close 事件，不能永久占用任务槽。
        finish(abortError(signal));
      }, config.installerKillGraceMs);
    };
    child.stdout.on('data', (c: Buffer) => {
      appendOutput(c);
    });
    child.stderr.on('data', (c: Buffer) => {
      appendOutput(c);
    });
    // 管道流 error 无监听器会成为未捕获异常；子进程退出时管道 EPIPE 属正常现象。
    child.stdout.on('error', () => {});
    child.stderr.on('error', () => {});
    child.once('error', (error) => finish(aborted || signal.aborted ? abortError(signal) : error));
    child.once('close', (code) => {
      if (aborted || signal.aborted) {
        finish(abortError(signal));
      } else if (code === 0) {
        finish();
      } else {
        if (pendingLine) reportInstallerLine(pendingLine, progressState, report);
        finish(new InstallerProcessError(code, output.toString('utf8')));
      }
    });
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

export async function runInstaller(
  installerJar: string,
  cwd: string,
  javaCommand: string,
  signal: AbortSignal,
  report?: (progress: number, message: string) => void,
): Promise<void> {
  const progressState: InstallerProgressState = { progress: 60, completedDownloads: 0 };
  for (let attempt = 1; attempt <= INSTALLER_MAX_ATTEMPTS; attempt += 1) {
    try {
      await runInstallerAttempt(installerJar, cwd, javaCommand, signal, progressState, report);
      return;
    } catch (error) {
      if (!(error instanceof InstallerProcessError) || signal.aborted) throw error;
      const retryable = isRetryableInstallerFailure(error.output);
      if (retryable && attempt < INSTALLER_MAX_ATTEMPTS) {
        report?.(
          progressState.progress,
          `Installer 下载不完整，正在自动重试（${attempt + 1}/${INSTALLER_MAX_ATTEMPTS}）…`,
        );
        continue;
      }
      if (retryable) {
        throw new Error(summarizeInstallerDownloadFailure(error.output, attempt));
      }
      throw error;
    }
  }
}

/**
 * 写入 user_jvm_args.txt（Forge/NeoForge 启动用）。
 */
export function writeUserJvmArgs(dir: string, jvmArgs: string): void {
  const file = resolveSafePath(dir, 'user_jvm_args.txt');
  const lines = serializeJvmArgFile(parseJvmArgs(jvmArgs));
  fs.writeFileSync(file, `${lines}\n`, 'utf8');
}
