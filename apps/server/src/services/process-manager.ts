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
import { parseJvmArgs, serializeJvmArgFile } from '../utils/jvm-args.js';
import { resolveJavaRuntimeCommand } from './java-runtime-service.js';

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

const defaultStopGraceMs = 15_000;

function getStopGraceMs(): number {
  const fromEnv = process.env.MMD_TEST_STOP_GRACE_MS;
  if (!fromEnv) return defaultStopGraceMs;
  const parsed = Number(fromEnv);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultStopGraceMs;
}

export class InstanceOperationConflictError extends Error {
  readonly code = 'INSTANCE_OPERATION_CONFLICT' as const;

  constructor(message: string) {
    super(message);
    this.name = 'InstanceOperationConflictError';
  }
}

export class InstanceStopPendingError extends Error {
  readonly code = 'INSTANCE_STOP_PENDING' as const;

  constructor(message = '实例仍在停止中，请等待或选择强制停止') {
    super(message);
    this.name = 'InstanceStopPendingError';
  }
}

export function isInstanceOperationConflictError(error: unknown): error is InstanceOperationConflictError {
  return error instanceof InstanceOperationConflictError;
}

export function isInstanceStopPendingError(error: unknown): error is InstanceStopPendingError {
  return error instanceof InstanceStopPendingError;
}

type ManagedProcess = {
  child: ChildProcessWithoutNullStreams | null;
  status: InstanceStatus;
  buffer: string[];
  bufferBytes: number;
  stdinAvailable: boolean;
  stdinBackpressured: boolean;
};

type ProcessSnapshot = Pick<ManagedProcess, 'status' | 'buffer' | 'bufferBytes'>;

export type MinecraftProcessSpawner = (
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; windowsHide: boolean },
) => ChildProcessWithoutNullStreams;

export type JavaRuntimeResolver = (javaRuntimeId: string | null) => Promise<string>;

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

function waitForChildExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<'exited' | 'timeout'> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve('exited');
      return;
    }
    const timeout = setTimeout(() => resolve('timeout'), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve('exited');
    });
  });
}

/**
 * 管理本机 Minecraft 实例进程的启停与控制台 I/O。
 */
export class ProcessManager extends EventEmitter {
  private processes = new Map<string, ManagedProcess>();
  private snapshots = new Map<string, ProcessSnapshot>();
  private operationTails = new Map<string, Promise<void>>();

  constructor(
    private readonly spawnMinecraft: MinecraftProcessSpawner = (command, args, options) =>
      spawn(command, args, options),
    private readonly resolveJavaCommand: JavaRuntimeResolver = resolveJavaRuntimeCommand,
  ) {
    super();
  }

  getStatus(instanceId: string): InstanceStatus {
    return this.processes.get(instanceId)?.status
      ?? this.snapshots.get(instanceId)?.status
      ?? 'stopped';
  }

  getBuffer(instanceId: string): string[] {
    return [...(this.processes.get(instanceId)?.buffer
      ?? this.snapshots.get(instanceId)?.buffer
      ?? [])];
  }

  isRunning(instanceId: string): boolean {
    const status = this.getStatus(instanceId);
    return status === 'running' || status === 'starting' || status === 'stopping';
  }

  getRunningCount(): number {
    return this.processes.size;
  }

  async start(instance: InstanceRow): Promise<void> {
    return this.withInstanceOperation(instance.id, () => this.startWithinLock(instance));
  }

  async stop(instanceId: string, force = false): Promise<void> {
    return this.withInstanceOperation(instanceId, () => this.stopWithinLock(instanceId, force));
  }

  async restart(instance: InstanceRow): Promise<void> {
    return this.withInstanceOperation(instance.id, async () => {
      if (this.isRunning(instance.id)) {
        await this.stopWithinLock(instance.id, false);
      }
      await this.startWithinLock(instance);
    });
  }

  /** 面板退出前逐个安全停止所有由当前进程管理的实例。 */
  async stopAll(): Promise<{ attempted: number; errors: string[]; stillStopping: string[] }> {
    const instanceIds = [...this.processes.keys()];
    const errors: string[] = [];
    const stillStopping: string[] = [];
    for (const instanceId of instanceIds) {
      try {
        await this.stop(instanceId);
      } catch (error) {
        if (isInstanceStopPendingError(error)) {
          stillStopping.push(instanceId);
          continue;
        }
        errors.push(`${instanceId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { attempted: instanceIds.length, errors, stillStopping };
  }

  sendCommand(instanceId: string, command: string): void {
    const managed = this.processes.get(instanceId);
    if (!managed || managed.status === 'stopped' || !managed.child) {
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

  /** 实例记录删除后同步清理当前进程内保留的终态与控制台历史。 */
  forget(instanceId: string): void {
    if (this.processes.has(instanceId)) {
      throw new Error('运行中的实例不能清理进程状态');
    }
    this.snapshots.delete(instanceId);
  }

  private async withInstanceOperation<T>(instanceId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.operationTails.get(instanceId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.operationTails.set(instanceId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.operationTails.get(instanceId) === tail) {
        this.operationTails.delete(instanceId);
      }
    }
  }

  private async startWithinLock(instance: InstanceRow): Promise<void> {
    if (this.isRunning(instance.id)) {
      throw new InstanceOperationConflictError('实例已在运行或正在启停');
    }

    const cwd = resolveDirFromRow(instance);
    assertSafeInstanceRoot(cwd);

    if (instance.accept_eula) {
      const eulaPath = resolveSafePath(cwd, 'eula.txt');
      fs.writeFileSync(eulaPath, 'eula=true\n', 'utf8');
    }

    const jvmArgs = parseJvmArgs(instance.jvm_args);
    let args: string[];

    if (instance.jar_file.startsWith('@args:')) {
      const argsRel = instance.jar_file.slice('@args:'.length);
      const argsAbs = resolveSafePath(cwd, argsRel);
      if (!fs.existsSync(argsAbs)) {
        throw new Error(`找不到 ModLoader 启动参数文件：${argsRel}`);
      }
      const safeArgsRel = path.relative(cwd, argsAbs).replace(/\\/g, '/');
      const userJvm = resolveSafePath(cwd, 'user_jvm_args.txt');
      fs.writeFileSync(userJvm, `${serializeJvmArgFile(jvmArgs)}\n`, 'utf8');
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

    const managed: ManagedProcess = {
      child: null,
      status: 'starting',
      buffer: [],
      bufferBytes: 0,
      stdinAvailable: true,
      stdinBackpressured: false,
    };
    this.snapshots.delete(instance.id);
    this.processes.set(instance.id, managed);
    this.emitStatus(instance.id, 'starting');

    try {
      const javaCommand = await this.resolveJavaCommand(instance.java_runtime_id);
      const child = this.spawnMinecraft(javaCommand, args, {
        cwd,
        env: getMinecraftChildEnv(),
        windowsHide: true,
      });
      managed.child = child;
      registerStdinSafetyHandlers(child.stdin, managed);

      const onChunk = (chunk: Buffer) => {
        if (this.processes.get(instance.id) !== managed) return;
        this.appendOutput(instance.id, chunk);
        if (managed.status === 'starting') {
          managed.status = 'running';
          this.emitStatus(instance.id, 'running');
        }
      };

      child.stdout.on('data', onChunk);
      child.stderr.on('data', onChunk);
      child.stdin.on('drain', () => {
        if (this.processes.get(instance.id) === managed && managed.stdinAvailable) {
          managed.stdinBackpressured = false;
        }
      });

      child.on('error', (err) => {
        if (this.processes.get(instance.id) !== managed) return;
        this.appendOutput(instance.id, `\n[面板] 进程启动失败：${err.message}\n`);
        this.archiveProcess(instance.id, managed, 'crashed');
      });

      child.on('exit', (code, signal) => {
        if (this.processes.get(instance.id) !== managed) return;
        const wasStopping = managed.status === 'stopping';
        const status = wasStopping ? 'stopped' : 'crashed';
        this.appendOutput(
          instance.id,
          `\n[面板] 进程已退出 code=${code ?? 'null'} signal=${signal ?? 'null'}\n`,
        );
        this.archiveProcess(instance.id, managed, status);
      });
    } catch (error) {
      this.processes.delete(instance.id);
      this.emitStatus(instance.id, 'stopped');
      throw error;
    }
  }

  private async stopWithinLock(instanceId: string, force: boolean): Promise<void> {
    const managed = this.processes.get(instanceId);
    if (!managed) {
      throw new Error('实例未在运行');
    }
    if (!managed.child) {
      throw new InstanceOperationConflictError('实例正在启动中，请稍后再试');
    }

    managed.status = 'stopping';
    this.emitStatus(instanceId, 'stopping');

    const child = managed.child;

    if (force) {
      child.kill('SIGKILL');
      const outcome = await waitForChildExit(child, getStopGraceMs());
      if (outcome === 'timeout' && this.processes.get(instanceId) === managed) {
        throw new InstanceStopPendingError('实例仍在强制终止中，请稍候');
      }
      return;
    }

    const stdin = child.stdin;
    if (!managed.stdinAvailable || stdin.writableEnded || stdin.destroyed || !stdin.writable) {
      throw new Error('实例输入流不可用，无法发送停止指令');
    }
    try {
      if (!stdin.write('stop\n')) managed.stdinBackpressured = true;
    } catch {
      managed.stdinAvailable = false;
      managed.stdinBackpressured = true;
      throw new Error('停止指令写入失败');
    }

    const outcome = await waitForChildExit(child, getStopGraceMs());
    if (outcome === 'timeout' && this.processes.get(instanceId) === managed) {
      throw new InstanceStopPendingError();
    }
  }

  private archiveProcess(
    instanceId: string,
    managed: ManagedProcess,
    status: Extract<InstanceStatus, 'stopped' | 'crashed'>,
  ): void {
    managed.status = status;
    this.emitStatus(instanceId, status);
    this.processes.delete(instanceId);
    this.snapshots.set(instanceId, {
      status,
      buffer: [...managed.buffer],
      bufferBytes: managed.bufferBytes,
    });
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
