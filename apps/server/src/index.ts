import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { getDb, initDb } from './db.js';
import { authRoutes, registerAuthHooks } from './routes/auth.js';
import { instanceRoutes } from './routes/instances.js';
import { fileRoutes } from './routes/files.js';
import { coreRoutes } from './routes/cores.js';
import { consoleRoutes } from './routes/console.js';
import { systemRoutes } from './routes/system.js';
import { nodeRoutes } from './routes/nodes.js';
import {
  launcherRoutes,
  type LauncherRouteOptions,
  type ShutdownSummary,
} from './routes/launcher.js';
import { processManager } from './services/process-manager.js';
import { createRateLimitHook } from './services/security-service.js';
import { getTaskActivity, shutdownTasks } from './services/task-service.js';

export type BuildAppOptions = LauncherRouteOptions & {
  isShuttingDown?: () => boolean;
};

export async function buildApp(options: BuildAppOptions = {}) {
  initDb();

  const app = Fastify({
    logger: true,
    bodyLimit: config.maxJsonBodyBytes,
    requestTimeout: config.httpRequestTimeoutMs,
    connectionTimeout: config.httpConnectionTimeoutMs,
    keepAliveTimeout: config.httpKeepAliveTimeoutMs,
    ajv: { customOptions: { removeAdditional: false } },
  });

  await app.register(cors, { origin: config.corsOrigins, credentials: true });
  await app.register(jwt, {
    secret: config.jwtSecret,
    sign: { expiresIn: config.jwtExpiresIn },
  });
  await app.register(multipart, {
    limits: {
      fileSize: config.maxUploadBytes,
      files: 1,
      fields: 10,
      parts: 20,
      fieldSize: 64 * 1024,
    },
  });
  await app.register(websocket, {
    options: {
      maxPayload: config.maxConsoleIncomingBytes,
      perMessageDeflate: false,
    },
  });

  app.addHook(
    'onRequest',
    createRateLimitHook({
      name: 'global',
      max: config.rateLimitMax,
      windowMs: config.rateLimitWindowMs,
    }),
  );
  app.addHook('onRequest', async (req, reply) => {
    if (
      options.isShuttingDown?.()
      && req.url !== '/api/health'
      && req.url !== '/api/launcher/shutdown'
    ) {
      return reply.code(503).send({ error: '面板正在关闭' });
    }
  });
  app.addHook('onSend', async (_req, reply, payload) => {
    // 不设置激进 CSP，避免破坏生产环境托管的前端资源；其余响应仍使用基础安全头。
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    reply.header('X-Permitted-Cross-Domain-Policies', 'none');
    return payload;
  });

  registerAuthHooks(app);

  await app.register(authRoutes);
  await app.register(instanceRoutes);
  await app.register(fileRoutes);
  await app.register(coreRoutes);
  await app.register(consoleRoutes);
  await app.register(systemRoutes);
  await app.register(nodeRoutes);
  await app.register(launcherRoutes, {
    prepareShutdown: options.prepareShutdown,
    startShutdown: options.startShutdown,
  });

  app.get('/api/health', async () => ({
    ok: true,
    service: 'minecraft-mystery-dashboard',
    ...(config.processFingerprint
      ? { processFingerprint: config.processFingerprint }
      : {}),
  }));

  // 生产环境托管前端构建产物
  if (fs.existsSync(config.webDist)) {
    await app.register(fastifyStatic, {
      root: config.webDist,
      wildcard: false,
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api') || req.url.startsWith('/ws')) {
        return reply.code(404).send({ error: 'Not Found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}

async function main() {
  let app: Awaited<ReturnType<typeof buildApp>> | null = null;
  let shuttingDown = false;
  let shutdownPromise: Promise<void> | null = null;
  let removeSignalHandlers = () => {};

  const prepareShutdown = (): ShutdownSummary => {
    const alreadyShuttingDown = shuttingDown;
    const taskActivity = getTaskActivity();
    const summary = {
      runningInstances: processManager.getRunningCount(),
      runningTasks: taskActivity.running,
      queuedTasks: taskActivity.queued,
      alreadyShuttingDown,
    };
    shuttingDown = true;
    return summary;
  };

  const shutdown = (reason: string): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    if (!shuttingDown) prepareShutdown();

    shutdownPromise = (async () => {
      removeSignalHandlers();
      app?.log.info({ reason }, '正在安全关闭面板');
      await shutdownTasks();
      const instanceResult = await processManager.stopAll();
      if (instanceResult.errors.length > 0) {
        app?.log.error(
          { errors: instanceResult.errors },
          '部分 Minecraft 实例关闭时发生错误',
        );
      }
      if (app) await app.close();
      getDb().close();
    })().catch((error) => {
      process.exitCode = 1;
      console.error('安全关闭面板失败', error);
    });
    return shutdownPromise;
  };

  app = await buildApp({
    isShuttingDown: () => shuttingDown,
    prepareShutdown,
    startShutdown: () => {
      void shutdown('launcher');
    },
  });
  const handleSigint = () => {
    prepareShutdown();
    void shutdown('SIGINT');
  };
  const handleSigterm = () => {
    prepareShutdown();
    void shutdown('SIGTERM');
  };
  removeSignalHandlers = () => {
    process.off('SIGINT', handleSigint);
    process.off('SIGTERM', handleSigterm);
  };
  process.once('SIGINT', handleSigint);
  process.once('SIGTERM', handleSigterm);
  await app.listen({ host: config.host, port: config.port });
  app.log.info(`面板已启动 http://${config.host}:${config.port}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
