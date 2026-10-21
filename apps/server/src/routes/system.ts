import type { FastifyInstance } from 'fastify';
import { detectJava } from '../services/java-detect.js';
import { scanJavaRuntimes } from '../services/java-runtime-service.js';
import { MetricsService } from '../services/metrics-service.js';
import { processManager } from '../services/process-manager.js';
import { config } from '../config.js';

export async function systemRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);
  const metrics = new MetricsService(config.dataDir, () => processManager.getMetricTargets());
  app.get('/api/system/metrics', () => metrics.get());

  app.get('/api/system/java', async (_req, reply) => {
    try {
      return await detectJava();
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get<{ Querystring: { refresh?: string } }>(
    '/api/system/java-runtimes',
    async (req, reply) => {
      try {
        const runtimes = await scanJavaRuntimes(req.query.refresh === '1');
        return { runtimes };
      } catch (err) {
        return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );
}
