import type { FastifyInstance } from 'fastify';
import type { DeployCoreInput } from '@mmd/shared';
import { deployCoreBodySchema } from '@mmd/shared';
import {
  deployCore,
  listCoreVersions,
  listFabricInstallers,
  listFabricLoaders,
  listForgeLoaders,
  listNeoForgeLoaders,
  listPaperBuilds,
} from '../services/core-depot.js';
import { importZipPackage } from '../services/import-service.js';
import { getTask, isTaskCapacityError } from '../services/task-service.js';
import {
  isUploadCapacityError,
  isUploadTooLargeError,
  removeUploadTemp,
  streamToUploadTemp,
} from '../services/upload-service.js';

function isCapacityError(error: unknown): boolean {
  return isTaskCapacityError(error) || isUploadCapacityError(error);
}

export async function coreRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get<{ Params: { type: 'vanilla' | 'paper' | 'fabric' | 'forge' | 'neoforge' } }>(
    '/api/cores/:type/versions',
    async (req, reply) => {
      try {
        const versions = await listCoreVersions(req.params.type);
        return { versions };
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get<{ Params: { version: string } }>('/api/cores/paper/:version/builds', async (req, reply) => {
    try {
      return { builds: await listPaperBuilds(req.params.version) };
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get<{ Params: { version: string } }>(
    '/api/cores/fabric/:version/loaders',
    async (req, reply) => {
      try {
        return {
          loaders: await listFabricLoaders(req.params.version),
          installers: await listFabricInstallers(),
        };
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get<{ Params: { version: string } }>(
    '/api/cores/forge/:version/loaders',
    async (req, reply) => {
      try {
        return { loaders: await listForgeLoaders(req.params.version) };
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get<{ Params: { version: string } }>(
    '/api/cores/neoforge/:version/loaders',
    async (req, reply) => {
      try {
        return { loaders: await listNeoForgeLoaders(req.params.version) };
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.post<{
    Body: DeployCoreInput;
  }>('/api/cores/deploy', { attachValidation: true, schema: { body: deployCoreBodySchema } }, async (req, reply) => {
    if (req.validationError) {
      return reply.code(400).send({ error: '部署参数包含不支持的字段或格式不正确' });
    }
    const body = req.body;
    if (!body?.name?.trim() || !body.coreType || !body.mcVersion) {
      return reply.code(400).send({ error: '缺少必要参数' });
    }
    try {
      const task = await deployCore(body);
      return task;
    } catch (err) {
      if (isCapacityError(err)) {
        return reply.code(429).send({ error: err instanceof Error ? err.message : String(err) });
      }
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get<{ Params: { id: string } }>('/api/tasks/:id', async (req, reply) => {
    const task = getTask(req.params.id);
    if (!task) return reply.code(404).send({ error: '任务不存在' });
    return task;
  });

  app.post('/api/import', async (req, reply) => {
    const parts = req.parts();
    let name = '';
    let jvmArgs = '-Xms1G -Xmx2G';
    let acceptEula = false;
    let removedField: 'javaPath' | 'installPath' | null = null;
    let zipPath: string | null = null;
    let handedOff = false;

    try {
      for await (const part of parts) {
        if (part.type === 'file') {
          if (zipPath) {
            // 仍然消费后续流，避免 multipart 连接被异常中断。
            const discarded = await streamToUploadTemp(part.file, 'discard');
            removeUploadTemp(discarded);
            return reply.code(400).send({ error: '只能上传一个 zip 安装包' });
          }
          zipPath = await streamToUploadTemp(part.file, 'import');
          if (part.file.truncated) {
            removeUploadTemp(zipPath);
            zipPath = null;
            return reply.code(413).send({ error: '文件过大' });
          }
        } else {
          const value = String(part.value);
          if (part.fieldname === 'name') name = value;
          if (part.fieldname === 'javaPath' || part.fieldname === 'installPath') {
            removedField = part.fieldname;
          }
          if (part.fieldname === 'jvmArgs') jvmArgs = value || '-Xms1G -Xmx2G';
          if (part.fieldname === 'acceptEula') acceptEula = value === 'true' || value === '1';
        }
      }

      if (removedField) {
        return reply.code(400).send({ error: `不支持已移除的字段：${removedField}` });
      }
      if (!name.trim()) return reply.code(400).send({ error: '名称不能为空' });
      if (!zipPath) return reply.code(400).send({ error: '请上传 zip 安装包' });

      const task = await importZipPackage({
        name: name.trim(),
        zipPath,
        jvmArgs,
        acceptEula,
      });
      handedOff = true;
      return task;
    } catch (err) {
      if (isUploadTooLargeError(err)) {
        return reply.code(413).send({ error: err.message });
      }
      if (isCapacityError(err)) {
        return reply.code(429).send({ error: err instanceof Error ? err.message : String(err) });
      }
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      if (!handedOff && zipPath) {
        try {
          removeUploadTemp(zipPath);
        } catch {
          /* ignore cleanup errors */
        }
      }
    }
  });
}
