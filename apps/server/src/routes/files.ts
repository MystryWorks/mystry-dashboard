import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import { config } from '../config.js';
import {
  acquireFileDownloadSlot,
  assertTextFileWithinLimit,
  deletePath,
  getAbsoluteFilePath,
  isFileDownloadCapacityError,
  listFiles,
  mkdirPath,
  readTextFile,
  renamePath,
  saveUploadedFile,
  writeTextFile,
} from '../services/file-service.js';
import { getInstance } from '../services/instance-service.js';
import { readServerProperties, stringifyProperties, writeServerProperties } from '../services/config-service.js';
import { isUploadCapacityError, isUploadTooLargeError } from '../services/upload-service.js';

type ResourceLimits = { maxTextFileBytes: number };
const maxTextFileBytes = (config as typeof config & Partial<ResourceLimits>).maxTextFileBytes ?? 1_048_576;
const maxPathLength = 1_024;
const maxPropertyKeys = 256;
const maxPropertyKeyLength = 256;

const optionalPathQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: { path: { type: 'string', maxLength: maxPathLength } },
} as const;

const requiredPathQuerySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: { path: { type: 'string', maxLength: maxPathLength } },
} as const;

const textContentBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['path', 'content'],
  properties: {
    path: { type: 'string', maxLength: maxPathLength },
    content: { type: 'string', maxLength: maxTextFileBytes },
  },
} as const;

const pathBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: { path: { type: 'string', maxLength: maxPathLength } },
} as const;

const renameBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['from', 'to'],
  properties: {
    from: { type: 'string', maxLength: maxPathLength },
    to: { type: 'string', maxLength: maxPathLength },
  },
} as const;

const serverPropertiesBodySchema = {
  type: 'object',
  maxProperties: maxPropertyKeys,
  propertyNames: { type: 'string', minLength: 1, maxLength: maxPropertyKeyLength },
  additionalProperties: { type: 'string', maxLength: maxTextFileBytes },
} as const;

function validationMessage(reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }, message: string) {
  return reply.code(400).send({ error: message });
}

export async function fileRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get<{ Params: { id: string }; Querystring: { path?: string } }>(
    '/api/instances/:id/files',
    { attachValidation: true, schema: { querystring: optionalPathQuerySchema } },
    async (req, reply) => {
      if (req.validationError) return validationMessage(reply, '文件路径过长或格式不正确');
      if (!getInstance(req.params.id)) return reply.code(404).send({ error: '实例不存在' });
      try {
        return listFiles(req.params.id, req.query.path || '');
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get<{ Params: { id: string }; Querystring: { path: string } }>(
    '/api/instances/:id/files/content',
    { attachValidation: true, schema: { querystring: requiredPathQuerySchema } },
    async (req, reply) => {
      if (req.validationError) return validationMessage(reply, '文件路径过长或格式不正确');
      if (!getInstance(req.params.id)) return reply.code(404).send({ error: '实例不存在' });
      try {
        const content = readTextFile(req.params.id, req.query.path);
        return { path: req.query.path, content };
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.put<{ Params: { id: string }; Body: { path: string; content: string } }>(
    '/api/instances/:id/files/content',
    { attachValidation: true, schema: { body: textContentBodySchema } },
    async (req, reply) => {
      if (req.validationError) return validationMessage(reply, '文本文件路径、内容过长或包含不支持的字段');
      if (!getInstance(req.params.id)) return reply.code(404).send({ error: '实例不存在' });
      try {
        writeTextFile(req.params.id, req.body.path, req.body.content);
        return { ok: true };
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.delete<{ Params: { id: string }; Querystring: { path: string } }>(
    '/api/instances/:id/files',
    { attachValidation: true, schema: { querystring: requiredPathQuerySchema } },
    async (req, reply) => {
      if (req.validationError) return validationMessage(reply, '文件路径过长或格式不正确');
      try {
        deletePath(req.params.id, req.query.path);
        return { ok: true };
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { path: string } }>(
    '/api/instances/:id/files/mkdir',
    { attachValidation: true, schema: { body: pathBodySchema } },
    async (req, reply) => {
      if (req.validationError) return validationMessage(reply, '目录路径过长或包含不支持的字段');
      try {
        mkdirPath(req.params.id, req.body.path);
        return { ok: true };
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { from: string; to: string } }>(
    '/api/instances/:id/files/rename',
    { attachValidation: true, schema: { body: renameBodySchema } },
    async (req, reply) => {
      if (req.validationError) return validationMessage(reply, '重命名路径过长或包含不支持的字段');
      try {
        renamePath(req.params.id, req.body.from, req.body.to);
        return { ok: true };
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get<{ Params: { id: string }; Querystring: { path: string } }>(
    '/api/instances/:id/files/download',
    { attachValidation: true, schema: { querystring: requiredPathQuerySchema } },
    async (req, reply) => {
      if (req.validationError) return validationMessage(reply, '文件路径过长或格式不正确');
      let releaseDownload: (() => void) | null = null;
      try {
        const abs = getAbsoluteFilePath(req.params.id, req.query.path);
        const release = acquireFileDownloadSlot();
        releaseDownload = release;
        const stream = fs.createReadStream(abs);
        let responseStarted = false;
        let cleaned = false;
        const cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          release();
          try {
            reply.raw.setTimeout(0);
          } catch {
            // 响应可能已经关闭。
          }
          if (!stream.destroyed) stream.destroy();
          reply.raw.off('close', cleanup);
        };
        const onStreamError = (error: Error) => {
          cleanup();
          if (responseStarted && !reply.sent) {
            void reply.code(400).send({ error: '文件读取失败' });
          }
        };
        stream.once('end', cleanup);
        stream.once('close', cleanup);
        stream.once('error', onStreamError);
        reply.raw.once('close', cleanup);
        reply.raw.setTimeout(config.fileDownloadIdleTimeoutMs, () => {
          stream.destroy(new Error('文件下载空闲超时'));
          if (!reply.raw.destroyed) reply.raw.destroy();
        });
        await new Promise<void>((resolve, reject) => {
          const onOpen = () => {
            stream.off('error', onError);
            resolve();
          };
          const onError = (error: Error) => {
            stream.off('open', onOpen);
            reject(error);
          };
          stream.once('open', onOpen);
          stream.once('error', onError);
        });
        responseStarted = true;
        return reply.type('application/octet-stream').send(stream);
      } catch (err) {
        releaseDownload?.();
        if (isFileDownloadCapacityError(err)) {
          return reply.code(429).send({ error: err.message });
        }
        const message = err instanceof Error && /^(文件不存在|目标不是普通文件)$/.test(err.message)
          ? err.message
          : '文件打开失败';
        return reply.code(400).send({ error: message });
      }
    },
  );

  app.post<{ Params: { id: string }; Querystring: { path?: string } }>(
    '/api/instances/:id/files/upload',
    { attachValidation: true, schema: { querystring: optionalPathQuerySchema } },
    async (req, reply) => {
      if (req.validationError) return validationMessage(reply, '目录路径过长或格式不正确');
      if (!getInstance(req.params.id)) return reply.code(404).send({ error: '实例不存在' });
      try {
        const file = await req.file();
        if (!file) return reply.code(400).send({ error: '未上传文件' });
        const saved = await saveUploadedFile(
          req.params.id,
          req.query.path || '',
          file.filename,
          file.file,
        );
        return { path: saved };
      } catch (err) {
        if (isUploadTooLargeError(err)) {
          return reply.code(413).send({ error: err.message });
        }
        if (isUploadCapacityError(err)) {
          return reply.code(429).send({ error: err instanceof Error ? err.message : String(err) });
        }
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.get<{ Params: { id: string } }>('/api/instances/:id/config/server.properties', async (req, reply) => {
    if (!getInstance(req.params.id)) return reply.code(404).send({ error: '实例不存在' });
    try {
      assertTextFileWithinLimit(req.params.id, 'server.properties');
      return readServerProperties(req.params.id);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.put<{ Params: { id: string }; Body: Record<string, string> }>(
    '/api/instances/:id/config/server.properties',
    { attachValidation: true, schema: { body: serverPropertiesBodySchema } },
    async (req, reply) => {
      if (!getInstance(req.params.id)) return reply.code(404).send({ error: '实例不存在' });
      if (req.validationError) return validationMessage(reply, 'server.properties 键数量、文本长度或格式不正确');
      try {
        assertTextFileWithinLimit(req.params.id, 'server.properties');
        if (Buffer.byteLength(stringifyProperties(req.body), 'utf8') > maxTextFileBytes) {
          return reply.code(400).send({ error: `server.properties 超过大小限制（${maxTextFileBytes} 字节）` });
        }
        writeServerProperties(req.params.id, req.body);
        return { ok: true };
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );
}
