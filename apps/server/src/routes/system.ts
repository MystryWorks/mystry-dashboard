import type { FastifyInstance } from 'fastify';
import { detectJava } from '../services/java-detect.js';

export async function systemRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get('/api/system/java', async (_req, reply) => {
    try {
      return await detectJava();
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
