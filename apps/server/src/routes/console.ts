import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { processManager } from '../services/process-manager.js';
import { getInstance } from '../services/instance-service.js';
import { issueConsoleTicket, consumeConsoleTicket } from '../services/console-ticket-service.js';

type ResourceLimits = {
  maxCommandBytes: number;
  maxConsoleBufferBytes: number;
  maxConsoleChunkBytes: number;
  maxConsoleIncomingBytes: number;
};
const resourceLimits = config as typeof config & Partial<ResourceLimits>;
const maxCommandBytes = resourceLimits.maxCommandBytes ?? 4_096;
const maxConsoleBufferBytes = resourceLimits.maxConsoleBufferBytes ?? 1_048_576;
const maxConsoleChunkBytes = resourceLimits.maxConsoleChunkBytes ?? 65_536;
const maxIncomingMessageBytes = resourceLimits.maxConsoleIncomingBytes ?? 4_352;
const maxOutgoingMessageBytes = maxConsoleBufferBytes + maxConsoleChunkBytes;
const maxSocketBufferedBytes = maxConsoleBufferBytes + maxConsoleChunkBytes;

let activeConsoleConnections = 0;

type ConsoleSocket = {
  readyState: number;
  bufferedAmount: number;
  close: (code?: number, reason?: string) => void;
  terminate?: () => void;
};

const socketClosedState = 3;

function closeSocket(
  socket: ConsoleSocket,
  code = 1000,
  reason = '',
): void {
  if (socket.readyState === 0 || socket.readyState === 1) {
    try {
      socket.close(code, reason);
    } catch {
      // 连接可能已在关闭过程中。
    }
  }
}

function terminateSocketLater(socket: ConsoleSocket): void {
  const timer = setTimeout(() => {
    if (socket.readyState === socketClosedState) return;
    try {
      if (socket.terminate) {
        socket.terminate();
      } else {
        socket.close(1000, '控制台连接关闭超时');
      }
    } catch {
      // 连接可能已经由底层关闭。
    }
  }, 1_000);
  timer.unref?.();
}

function sendSocketMessage(
  socket: {
    readyState: number;
    bufferedAmount: number;
    send: (data: string) => void;
    close: (code?: number, reason?: string) => void;
  },
  payload: unknown,
): boolean {
  if (socket.readyState !== 1) return false;
  const message = JSON.stringify(payload);
  const messageBytes = Buffer.byteLength(message, 'utf8');
  if (messageBytes > maxOutgoingMessageBytes || socket.bufferedAmount + messageBytes > maxSocketBufferedBytes) {
    closeSocket(socket, 1009, '控制台发送缓冲过大');
    terminateSocketLater(socket);
    return false;
  }
  try {
    socket.send(message);
    return true;
  } catch {
    closeSocket(socket, 1011, '控制台连接发送失败');
    terminateSocketLater(socket);
    return false;
  }
}

function rawMessageToString(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (Buffer.isBuffer(raw)) return raw.toString('utf8');
  if (Array.isArray(raw)) return Buffer.concat(raw as Buffer[]).toString('utf8');
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8');
  return String(raw);
}

function rawMessageByteLength(raw: unknown): number {
  if (typeof raw === 'string') return Buffer.byteLength(raw, 'utf8');
  if (Buffer.isBuffer(raw)) return raw.byteLength;
  if (Array.isArray(raw)) {
    return raw.reduce((total, part) => total + (Buffer.isBuffer(part) ? part.byteLength : Buffer.byteLength(String(part), 'utf8')), 0);
  }
  if (raw instanceof ArrayBuffer) return raw.byteLength;
  return Buffer.byteLength(String(raw), 'utf8');
}

export async function consoleRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string } }>(
    '/api/instances/:id/console-ticket',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!getInstance(req.params.id)) return reply.code(404).send({ error: '实例不存在' });
      return issueConsoleTicket(req.user.id, req.params.id);
    },
  );

  app.get<{ Params: { id: string }; Querystring: { ticket?: string } }>(
    '/ws/console/:id',
    { websocket: true },
    async (socket, req) => {
      if (activeConsoleConnections >= config.maxConsoleConnections) {
        closeSocket(socket, 1013, '控制台连接数已达上限，请稍后重试');
        terminateSocketLater(socket);
        return;
      }

      activeConsoleConnections += 1;
      let connectionReleased = false;
      let detachRealtimeListeners: (() => void) | null = null;
      const releaseConnection = () => {
        if (connectionReleased) return;
        connectionReleased = true;
        detachRealtimeListeners?.();
        activeConsoleConnections -= 1;
      };
      socket.on('close', releaseConnection);
      socket.on('error', () => {
        // 仅在 close 后释放计数，避免 error 先于 close 时低估活动连接数。
        closeSocket(socket, 1011, '控制台连接异常');
        terminateSocketLater(socket);
      });

      try {
        const ticket = req.query.ticket;
        if (!ticket) {
          sendSocketMessage(socket, { type: 'error', data: '缺少 console ticket' });
          closeSocket(socket);
          terminateSocketLater(socket);
          return;
        }
        if (!consumeConsoleTicket(ticket, req.params.id)) {
          sendSocketMessage(socket, { type: 'error', data: 'console ticket 无效或已过期' });
          closeSocket(socket);
          terminateSocketLater(socket);
          return;
        }
      } catch {
        sendSocketMessage(socket, { type: 'error', data: '未授权' });
        closeSocket(socket);
        terminateSocketLater(socket);
        return;
      }

      const instanceId = req.params.id;
      if (!getInstance(instanceId)) {
        sendSocketMessage(socket, { type: 'error', data: '实例不存在' });
        closeSocket(socket);
        terminateSocketLater(socket);
        return;
      }

      let commandWindowStartedAt = Date.now();
      let commandCount = 0;
      const history = processManager.getHistory(instanceId);
      if (!sendSocketMessage(socket, {
        type: 'history',
        data: history,
        status: processManager.getStatus(instanceId),
      })) {
        terminateSocketLater(socket);
        return;
      }
      if (!sendSocketMessage(socket, {
        type: 'status',
        data: '',
        status: processManager.getStatus(instanceId),
      })) {
        terminateSocketLater(socket);
        return;
      }

      const onOutput = (id: string, text: string) => {
        if (id !== instanceId) return;
        if (Buffer.byteLength(text, 'utf8') > maxConsoleChunkBytes) {
          closeSocket(socket, 1009, '控制台输出消息过大');
          return;
        }
        sendSocketMessage(socket, { type: 'output', data: text });
      };
      const onStatus = (id: string, status: string) => {
        if (id !== instanceId) return;
        sendSocketMessage(socket, { type: 'status', data: '', status });
      };

      processManager.on('output', onOutput);
      processManager.on('status', onStatus);
      detachRealtimeListeners = () => {
        processManager.off('output', onOutput);
        processManager.off('status', onStatus);
      };

      socket.on('message', (raw) => {
        try {
          if (rawMessageByteLength(raw) > maxIncomingMessageBytes) {
            sendSocketMessage(socket, { type: 'error', data: `控制台消息超过大小限制（${maxIncomingMessageBytes} 字节）` });
            closeSocket(socket, 1009, '控制台消息过大');
            return;
          }
          const rawText = rawMessageToString(raw);
          const msg = JSON.parse(rawText) as { type?: string; data?: string };
          if (msg.type !== 'command' || typeof msg.data !== 'string') return;

          const now = Date.now();
          if (now - commandWindowStartedAt >= config.consoleCommandWindowMs) {
            commandWindowStartedAt = now;
            commandCount = 0;
          }
          if (commandCount >= config.maxConsoleCommandsPerWindow) {
            sendSocketMessage(socket, { type: 'error', data: '控制台指令频率超过限制，请稍后重试' });
            closeSocket(socket, 1008, '控制台指令频率超过限制');
            return;
          }
          commandCount += 1;
          processManager.sendCommand(instanceId, msg.data);
        } catch (err) {
          sendSocketMessage(socket, {
            type: 'error',
            data: err instanceof Error ? err.message : String(err),
          });
        }
      });

    },
  );
}
