import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { createRateLimitHook } from '../services/security-service.js';

export type ShutdownSummary = {
  runningInstances: number;
  runningTasks: number;
  queuedTasks: number;
  alreadyShuttingDown: boolean;
};

export type LauncherRouteOptions = {
  prepareShutdown?: () => ShutdownSummary;
  startShutdown?: () => void;
};

function isLoopbackAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  return normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '::ffff:127.0.0.1';
}

function isValidLauncherToken(value: string | string[] | undefined): boolean {
  if (config.launcherToken === null || typeof value !== 'string') return false;
  const expected = Buffer.from(config.launcherToken, 'utf8');
  const actual = Buffer.from(value, 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** 仅供本机 PanelManager 调用的安全关闭通道。 */
export async function launcherRoutes(
  app: FastifyInstance,
  options: LauncherRouteOptions,
): Promise<void> {
  const strictLauncherLimit = createRateLimitHook({
    name: 'launcher',
    max: config.authRateLimitMax,
    windowMs: config.authRateLimitWindowMs,
  });

  app.post(
    '/api/launcher/shutdown',
    { preHandler: [strictLauncherLimit] },
    async (req, reply) => {
      if (!isLoopbackAddress(req.ip)) {
        return reply.code(403).send({ error: '关闭接口仅允许本机访问' });
      }
      if (!isValidLauncherToken(req.headers['x-launcher-token'])) {
        return reply.code(401).send({ error: '启动器令牌无效' });
      }
      if (!options.prepareShutdown || !options.startShutdown) {
        return reply.code(503).send({ error: '当前运行方式不支持启动器关闭' });
      }

      const summary = options.prepareShutdown();
      // 客户端在响应刷新前断开时 reply 'finish' 不会触发，'close' 兜底启动关闭流程，
      // 否则面板会停留在 503 拒服务空窗。startShutdown 内部对重复调用有去重。
      reply.raw.once('finish', options.startShutdown);
      reply.raw.once('close', options.startShutdown);
      return reply.code(202).send({ accepted: true, ...summary });
    },
  );
}
