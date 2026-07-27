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
import { initDb } from './db.js';
import { authRoutes, registerAuthHooks } from './routes/auth.js';
import { instanceRoutes } from './routes/instances.js';
import { fileRoutes } from './routes/files.js';
import { coreRoutes } from './routes/cores.js';
import { consoleRoutes } from './routes/console.js';
import { systemRoutes } from './routes/system.js';
import { nodeRoutes } from './routes/nodes.js';
import { createRateLimitHook } from './services/security-service.js';

export async function buildApp() {
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

  app.get('/api/health', async () => ({ ok: true }));

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
  const app = await buildApp();
  await app.listen({ host: config.host, port: config.port });
  app.log.info(`面板已启动 http://${config.host}:${config.port}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
