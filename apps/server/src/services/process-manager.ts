import { EventEmitter } from 'node:events';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Writable } from 'node:stream';
import type { InstanceStatus } from '@mmd/shared';
import type { InstanceRow } from '../db.js';
import { config } from '../config.js';
import { assertSafeInstanceRoot, resolveDirFromRow, resolveSafePath } from '../utils/path.js';
import { getMinecraftChildEnv } from '../utils/child-env.js';

type ResourceLimits = {
  maxCommandBytes: number;
  maxConsoleBufferBytes: number;
  maxConsoleChunkBytes: number;
  maxConsoleStdinBytes: number;
};
const resourceLimits = config as typeof config & Partial<ResourceLimits>;
const maxCommandBytes = resourceLimits.maxCommandBytes ?? 4_096;
const maxConsoleBufferBytes = resourceLimits.maxConsoleBufferBytes ?? 1_048_576;
const maxConsoleChunkBytes = resourceLimits.maxConsoleChunkBytes ?? 65_536;
const maxConsoleStdinBytes = resourceLimits.maxConsoleStdinBytes ?? 65_536;

type ManagedProcess = {
  child: ChildProcessWithoutNullStreams;
  status: InstanceStatus;
  buffer: string[];
  bufferBytes: number;
  stdinAvailable: boolean;
  stdinBackpressured: boolean;
};

export type StdinSafetyState = Pick<ManagedProcess, 'stdinAvailable' | 'stdinBackpressured'>;

/** 给 stdin 注册永久监听，避免异步写入错误变成未处理异常。 */
export function registerStdinSafetyHandlers(stdin: Writable, state: StdinSafetyState): void {
  const markUnavailable = () => {
    state.stdinAvailable = false;
    state.stdinBackpressured = true;
  };
  stdin.on('error', markUnavailable);
  stdin.on('close', markUnavailable);
  stdin.on('finish', markUnavailable);
}

function takeUtf8Prefix(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  let bytes = 0;
  let end = '';
  for (const character of text) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (bytes + characterBytes > maxBytes) break;
    end += character;
    bytes += characterBytes;
  }
  return end;
}

function takeUtf8Suffix(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  const characters = Array.from(text);
  let bytes = 0;
  let start = characters.length;
  while (start > 0) {
    const characterBytes = Buffer.byteLength(characters[start - 1], 'utf8');
    if (bytes + characterBytes > maxBytes) break;
    bytes += characterBytes;
    start -= 1;
  }
  return characters.slice(start).join('');
}

/**
 * 管理本机 Minecraft 实例进程的启停与控制台 I/O。
 */
export class ProcessManager extends EventEmitter {
  private processes = new Map<string, ManagedProcess>();

  getStatus(instanceId: string): InstanceStatus {
    return this.processes.get(instanceId)?.status ?? 'stopped';
  }

  getBuffer(instanceId: string): string[] {
    return [...(this.processes.get(instanceId)?.buffer ?? [])];
  }

  isRunning(instanceId: string): boolean {
    const status = this.getStatus(instanceId);
    return status === 'running' || status === 'starting' || status === 'stopping';
  }

  async start(instance: InstanceRow): Promise<void> {
    if (this.isRunning(instance.id)) {
      throw new Error('实例已在运行或正在启停');
    }

    const cwd = resolveDirFromRow(instance);
    assertSafeInstanceRoot(cwd);

    if (instance.accept_eula) {
      const eulaPath = resolveSafePath(cwd, 'eula.txt');
      fs.writeFileSync(eulaPath, 'eula=true\n', 'utf8');
    }

    const jvmArgs = instance.jvm_args.trim().split(/\s+/).filter(Boolean);
    let args: string[];

    // Forge / NeoForge：使用 @user_jvm_args.txt + @xxx_args.txt
    if (instance.jar_file.startsWith('@args:')) {
      const argsRel = instance.jar_file.slice('@args:'.length);
      const argsAbs = resolveSafePath(cwd, argsRel);
      if (!fs.existsSync(argsAbs)) {
        throw new Error(`找不到 ModLoader 启动参数文件：${argsRel}`);
      }
      const safeArgsRel = path.relative(cwd, argsAbs).replace(/\\/g, '/');
      // 同步 JVM 参数到 user_jvm_args.txt
      const userJvm = resolveSafePath(cwd, 'user_jvm_args.txt');
      fs.writeFileSync(userJvm, `${jvmArgs.join('\n')}\n`, 'utf8');
      // Forge 官方 run 脚本使用相对路径的 @argfile
      args = ['@user_jvm_args.txt', `@${safeArgsRel}`, 'nogui'];
    } else if (instance.jar_file === '@modloader') {
      throw new Error('ModLoader 尚未完成安装，请重新部署或检查安装日志');
    } else {
      const jarPath = resolveSafePath(cwd, instance.jar_file);
      if (!fs.existsSync(jarPath)) {
        throw new Error(`找不到服务端 jar：${instance.jar_file}`);
      }
      const safeJarRel = path.relative(cwd, jarPath).replace(/\\/g, '/');
      args = [...jvmArgs, '-jar', safeJarRel, 'nogui'];
    }

    const child = spawn('java', args, {
      cwd,
      env: getMinecraftChildEnv(),
      windowsHide: true,
    });

    const managed: ManagedProcess = {
      child,
      status: 'starting',
      buffer: [],
      bufferBytes: 0,
      stdinAvailable: true,
      stdinBackpressured: false,
    };
    registerStdinSafetyHandlers(child.stdin, managed);
    this.processes.set(instance.id, managed);
    this.emitStatus(instance.id, 'starting');

    const onChunk = (chunk: Buffer) => {
      this.appendOutput(instance.id, chunk);
      if (managed.status === 'starting') {
        managed.status = 'running';
        this.emitStatus(instance.id, 'running');
      }
    };

    child.stdout.on('data', onChunk);
    child.stderr.on('data', onChunk);
    child.stdin.on('drain', () => {
      if (managed.stdinAvailable) managed.stdinBackpressured = false;
    });

    child.on('error', (err) => {
      this.appendOutput(instance.id, `\n[面板] 进程启动失败：${err.message}\n`);
      managed.status = 'crashed';
      this.emitStatus(instance.id, 'crashed');
      this.processes.delete(instance.id);
    });

    child.on('exit', (code, signal) => {
      const current = this.processes.get(instance.id);
      if (!current) return;
      const wasStopping = current.status === 'stopping';
      current.status = wasStopping ? 'stopped' : 'crashed';
      this.appendOutput(
        instance.id,
        `\n[面板] 进程已退出 code=${code ?? 'null'} signal=${signal ?? 'null'}\n`,
      );
      this.emitStatus(instance.id, current.status);
      this.processes.delete(instance.id);
    });
  }

  async stop(instanceId: string, force = false): Promise<void> {
    const managed = this.processes.get(instanceId);
    if (!managed) {
      throw new Error('实例未在运行');
    }

    managed.status = 'stopping';
    this.emitStatus(instanceId, 'stopping');

    if (force) {
      managed.child.kill('SIGKILL');
      return;
    }

    let writeError: Error | null = null;
    const stdin = managed.child.stdin;
    if (!managed.stdinAvailable || stdin.writableEnded || stdin.destroyed || !stdin.writable) {
      writeError = new Error('实例输入流不可用，已尝试终止进程');
    } else {
      try {
        if (!stdin.write('stop\n')) managed.stdinBackpressured = true;
      } catch {
        managed.stdinAvailable = false;
        managed.stdinBackpressured = true;
        writeError = new Error('停止指令写入失败，已尝试终止进程');
      }
    }
    if (writeError) {
      try {
        managed.child.kill('SIGTERM');
      } catch {
        // 进程可能已经退出，保留可控的中文写入错误。
      }
    }

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (this.processes.has(instanceId)) {
          managed.child.kill('SIGKILL');
        }
        resolve();
      }, 15000);

      managed.child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    if (writeError) throw writeError;
  }

  async restart(instance: InstanceRow): Promise<void> {
    if (this.isRunning(instance.id)) {
      await this.stop(instance.id);
    }
    await this.start(instance);
  }

  sendCommand(instanceId: string, command: string): void {
    const managed = this.processes.get(instanceId);
    if (!managed || managed.status === 'stopped') {
      throw new Error('实例未在运行，无法发送指令');
    }

    if (typeof command !== 'string' || command.trim().length === 0) {
      throw new Error('指令不能为空');
    }
    if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(command)) {
      throw new Error('指令不能包含换行或控制字符');
    }
    const commandBytes = Buffer.byteLength(command, 'utf8');
    if (commandBytes > maxCommandBytes) {
      throw new Error(`指令超过大小限制（${maxCommandBytes} 字节）`);
    }

    const line = `${command}\n`;
    const lineBytes = Buffer.byteLength(line, 'utf8');
    if (lineBytes > maxCommandBytes + 1) {
      throw new Error(`指令超过大小限制（${maxCommandBytes} 字节）`);
    }
    if (managed.stdinBackpressured) {
      throw new Error('控制台输入缓冲繁忙，请稍后重试');
    }
    const stdin = managed.child.stdin;
    if (!managed.stdinAvailable || stdin.writableEnded || stdin.destroyed || !stdin.writable) {
      throw new Error('实例输入流不可用');
    }
    if (stdin.writableLength + lineBytes > maxConsoleStdinBytes) {
      throw new Error(`控制台输入缓冲超过大小限制（${maxConsoleStdinBytes} 字节）`);
    }
    try {
      const accepted = stdin.write(line);
      if (!accepted) {
        managed.stdinBackpressured = true;
      }
    } catch {
      managed.stdinAvailable = false;
      managed.stdinBackpressured = true;
      throw new Error('控制台指令写入失败，实例输入流不可用');
    }
  }

  getHistory(instanceId: string): string {
    return this.getBuffer(instanceId).join('');
  }

  private appendOutput(instanceId: string, text: string | Buffer): void {
    const managed = this.processes.get(instanceId);
    if (!managed) return;

    const chunkText = Buffer.isBuffer(text)
      ? text.subarray(0, maxConsoleChunkBytes).toString('utf8')
      : text;
    const output = takeUtf8Prefix(chunkText, maxConsoleChunkBytes);
    const outputBytes = Buffer.byteLength(output, 'utf8');
    if (outputBytes === 0) return;

    managed.buffer.push(output);
    managed.bufferBytes += outputBytes;
    while (managed.bufferBytes > maxConsoleBufferBytes && managed.buffer.length > 0) {
      const excess = managed.bufferBytes - maxConsoleBufferBytes;
      const oldest = managed.buffer[0];
      const oldestBytes = Buffer.byteLength(oldest, 'utf8');
      if (oldestBytes <= excess) {
        managed.buffer.shift();
        managed.bufferBytes -= oldestBytes;
      } else {
        const retained = takeUtf8Suffix(oldest, oldestBytes - excess);
        managed.buffer[0] = retained;
        managed.bufferBytes -= oldestBytes - Buffer.byteLength(retained, 'utf8');
      }
    }
    this.emit('output', instanceId, output);
  }

  private emitStatus(instanceId: string, status: InstanceStatus): void {
    this.emit('status', instanceId, status);
  }
}

export const processManager = new ProcessManager();
