import type { FastifyInstance } from 'fastify';
import type {
  ConfirmZipImportInput,
  CoreType,
  DeployCoreInput,
  ImportExistingServerInput,
} from '@mmd/shared';
import {
  CORE_TYPE_ENUM,
  DEPLOYABLE_CORE_TYPE_ENUM,
  deployCoreBodySchema,
  confirmZipImportBodySchema,
  importExistingServerBodySchema,
} from '@mmd/shared';
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
import {
  importExistingServerDirectory,
  listExistingServerSources,
} from '../services/existing-server-import-service.js';
import {
  getTask,
  isTaskCapacityError,
  isTaskShuttingDownError,
  listTasks,
} from '../services/task-service.js';
import {
  isUploadCapacityError,
  isUploadTooLargeError,
  removeUploadTemp,
  streamToUploadTemp,
} from '../services/upload-service.js';
import {
  ImportPreviewHttpError,
  cancelImportPreview,
  confirmImportPreview,
  createImportPreview,
  getImportPreview,
} from '../services/import-preview-service.js';

function isCapacityError(error: unknown): boolean {
  return isTaskCapacityError(error) || isUploadCapacityError(error);
}

export async function coreRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get<{ Params: { type: 'vanilla' | 'paper' | 'fabric' | 'forge' | 'neoforge' } }>(
    '/api/cores/:type/versions',
    {
      attachValidation: true,
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['type'],
          properties: { type: { type: 'string', enum: [...DEPLOYABLE_CORE_TYPE_ENUM] } },
        },
      },
    },
    async (req, reply) => {
      if (req.validationError) {
        return reply.code(400).send({ error: '不支持的核心类型' });
      }
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
      if (isTaskShuttingDownError(err)) {
        return reply.code(503).send({ error: err.message });
      }
      if (isCapacityError(err)) {
        return reply.code(429).send({ error: err instanceof Error ? err.message : String(err) });
      }
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/tasks', async () => ({ tasks: listTasks(50) }));

  app.get<{ Params: { id: string } }>('/api/tasks/:id', async (req, reply) => {
    const task = getTask(req.params.id);
    if (!task) return reply.code(404).send({ error: '任务不存在' });
    return task;
  });

  app.get('/api/import/sources', async (_req, reply) => {
    try {
      return { sources: await listExistingServerSources() };
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post<{
    Body: ImportExistingServerInput;
  }>(
    '/api/import/existing',
    { attachValidation: true, schema: { body: importExistingServerBodySchema } },
    async (req, reply) => {
      if (req.validationError) {
        return reply.code(400).send({ error: '已有服务端导入参数包含不支持的字段或格式不正确' });
      }
      if (!req.body?.name?.trim() || !req.body.sourceId) {
        return reply.code(400).send({ error: '实例名称和交接目录不能为空' });
      }
      try {
        return await importExistingServerDirectory({
          ...req.body,
          name: req.body.name.trim(),
        });
      } catch (err) {
        if (isTaskShuttingDownError(err)) {
          return reply.code(503).send({ error: err.message });
        }
        if (isCapacityError(err)) {
          return reply.code(429).send({ error: err instanceof Error ? err.message : String(err) });
        }
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.post('/api/import/previews', async (req, reply) => {
    const parts = req.parts();
    let zipPath: string | null = null;
    let fileName = 'server.zip';
    let handedOff = false;
    try {
      for await (const part of parts) {
        if (part.type !== 'file') {
          return reply.code(400).send({ error: 'ZIP 预览只接受一个安装包文件' });
        }
        if (zipPath) {
          const discarded = await streamToUploadTemp(part.file, 'discard');
          removeUploadTemp(discarded);
          return reply.code(400).send({ error: '只能上传一个 zip 安装包' });
        }
        fileName = part.filename || fileName;
        zipPath = await streamToUploadTemp(part.file, 'import-preview');
        if (part.file.truncated) {
          removeUploadTemp(zipPath);
          zipPath = null;
          return reply.code(413).send({ error: '文件过大' });
        }
      }
      if (!zipPath) return reply.code(400).send({ error: '请上传 zip 安装包' });
      const preview = await createImportPreview({
        userId: req.user.id,
        fileName,
        zipPath,
      });
      handedOff = true;
      return preview;
    } catch (error) {
      if (error instanceof ImportPreviewHttpError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      if (isUploadTooLargeError(error)) return reply.code(413).send({ error: error.message });
      if (isCapacityError(error)) {
        return reply.code(429).send({ error: error instanceof Error ? error.message : String(error) });
      }
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (!handedOff && zipPath) {
        try {
          removeUploadTemp(zipPath);
        } catch {
          /* 清理失败不覆盖原始响应。 */
        }
      }
    }
  });

  app.get<{ Params: { id: string } }>('/api/import/previews/:id', async (req, reply) => {
    try {
      return getImportPreview(req.params.id, req.user.id);
    } catch (error) {
      if (error instanceof ImportPreviewHttpError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Params: { id: string }; Body: ConfirmZipImportInput }>(
    '/api/import/previews/:id/confirm',
    { attachValidation: true, schema: { body: confirmZipImportBodySchema } },
    async (req, reply) => {
      if (req.validationError || !req.body?.name?.trim()) {
        return reply.code(400).send({ error: 'ZIP 导入确认参数包含不支持的字段或格式不正确' });
      }
      try {
        return await confirmImportPreview(req.params.id, req.user.id, {
          ...req.body,
          name: req.body.name.trim(),
        });
      } catch (error) {
        if (error instanceof ImportPreviewHttpError) {
          return reply.code(error.statusCode).send({ error: error.message });
        }
        if (isTaskShuttingDownError(error)) {
          return reply.code(503).send({ error: error.message });
        }
        if (isCapacityError(error)) {
          return reply.code(429).send({ error: error instanceof Error ? error.message : String(error) });
        }
        return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
      }
    },
  );

  app.delete<{ Params: { id: string } }>('/api/import/previews/:id', async (req, reply) => {
    try {
      cancelImportPreview(req.params.id, req.user.id);
      return { ok: true };
    } catch (error) {
      if (error instanceof ImportPreviewHttpError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/import', async (req, reply) => {
    const parts = req.parts();
    let name = '';
    let coreType: CoreType | undefined;
    let mcVersion: string | undefined;
    let jvmArgs = '-Xms1G -Xmx2G';
    let acceptEula = false;
    let javaRuntimeId: string | null | undefined;
    let invalidCoreType = false;
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
          if (part.fieldname === 'coreType') {
            if ((CORE_TYPE_ENUM as readonly string[]).includes(value)) coreType = value as CoreType;
            else invalidCoreType = true;
          }
          if (part.fieldname === 'mcVersion') mcVersion = value.trim() || undefined;
          if (part.fieldname === 'javaRuntimeId') javaRuntimeId = value.trim() || null;
        }
      }

      if (removedField) {
        return reply.code(400).send({ error: `不支持已移除的字段：${removedField}` });
      }
      if (invalidCoreType) return reply.code(400).send({ error: '核心类型不受支持' });
      if (name.length > 128) return reply.code(400).send({ error: '实例名称过长' });
      if (!name.trim()) return reply.code(400).send({ error: '名称不能为空' });
      if (jvmArgs.length > 8192) return reply.code(400).send({ error: 'JVM 参数过长' });
      if (mcVersion && mcVersion.length > 64) {
        return reply.code(400).send({ error: 'MC 版本过长' });
      }
      if (javaRuntimeId && javaRuntimeId.length > 255) {
        return reply.code(400).send({ error: 'Java 运行时 ID 过长' });
      }
      if (!zipPath) return reply.code(400).send({ error: '请上传 zip 安装包' });

      const task = await importZipPackage({
        name: name.trim(),
        zipPath,
        coreType,
        mcVersion,
        jvmArgs,
        acceptEula,
        javaRuntimeId,
      });
      handedOff = true;
      return task;
    } catch (err) {
      if (isUploadTooLargeError(err)) {
        return reply.code(413).send({ error: err.message });
      }
      if (isTaskShuttingDownError(err)) {
        return reply.code(503).send({ error: err.message });
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
