import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';

export async function registerFrontendAssets(
  app: FastifyInstance,
  webDist: string,
): Promise<void> {
  if (!fs.existsSync(webDist)) return;

  await app.register(fastifyStatic, {
    root: webDist,
    wildcard: true,
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api') || req.url.startsWith('/ws')) {
      return reply.code(404).send({ error: 'Not Found' });
    }
    return reply.sendFile('index.html');
  });
}
