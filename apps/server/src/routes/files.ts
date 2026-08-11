import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { fileDownloadQuerySchema, fileDownloadTicketBodySchema } from '@mmd/shared';
import { config } from '../config.js';
import {
  acquireFileDownloadSlot,
  assertTextFileWithinLimit,
  deletePath,
  fileServiceErrorHttpStatus,
  getAbsoluteFilePath,
  isFileDownloadCapacityError,
  listFiles,
  mkdirPath,
  readTextFile,
  renamePath,
  saveUploadedFile,
  writeTextFile,
} from '../services/file-service.js';
import {
  beginDownloadStream,
  cancelReservedDownloadTicket,
  completeDownloadStream,
  failDownloadStream,
  getDownloadTicketStatus,
  reserveDownloadTicket,
} from '../services/download-ticket-service.js';
import { getInstance } from '../services/instance-service.js';
import {
  previewServerPropertiesWrite,
  writeServerProperties,
  readServerProperties,
} from '../services/config-service.js';
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

/** 仅用 basename，附带 RFC 5987 filename*，禁止路径注入。 */
function contentDispositionAttachment(fileName: string): string {
  const basename = path.basename(fileName);
  const asciiFallback = basename
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(basename).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

function isDownloadRoute(req: FastifyRequest): boolean {
  const routePath = req.routeOptions.url;
  return routePath === '/api/instances/:id/files/download';
}

export function waitForDownloadStreamOpen(stream: EventEmitter): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      stream.off('open', onOpen);
      stream.off('error', onError);
      stream.off('close', onClose);
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => {
      cleanup();
      reject(new Error('文件下载连接已中止'));
    };
    stream.once('open', onOpen);
    stream.once('error', onError);
    stream.once('close', onClose);
  });
}

type DownloadTicketCancelRouteResult =
  | { statusCode: 204 }
  | { statusCode: 409; error: string }
  | { statusCode: 404; error: string };

export function cancelDownloadTicketRoute(
  ticket: string,
  userId: string,
  instanceId: string,
): DownloadTicketCancelRouteResult {
  const result = cancelReservedDownloadTicket(ticket, userId, instanceId);
  if (result === 'cancelled') return { statusCode: 204 };
  if (result === 'streaming') return { statusCode: 409, error: '下载已开始，无法取消票据' };
  return { statusCode: 404, error: '下载票据不存在或无权取消' };
}

export async function fileRoutes(app: FastifyInstance): Promise<void> {
  // 下载可用一次性 ticket 代替 JWT（浏览器原生导航无法带 Authorization）
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    if (isDownloadRoute(req)) {
      const ticket = (req.query as { ticket?: string }).ticket;
      if (typeof ticket === 'string' && ticket.length > 0) return;
    }
    return app.authenticate(req, reply);
  });

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
        return reply.code(fileServiceErrorHttpStatus(err)).send({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { path: string } }>(
    '/api/instances/:id/files/download-ticket',
    { attachValidation: true, schema: { body: fileDownloadTicketBodySchema } },
    async (req, reply) => {
      if (req.validationError) return validationMessage(reply, '文件路径过长或包含不支持的字段');
      if (!getInstance(req.params.id)) return reply.code(404).send({ error: '实例不存在' });
      let releaseDownload: (() => void) | null = null;
      try {
        getAbsoluteFilePath(req.params.id, req.body.path);
        releaseDownload = acquireFileDownloadSlot();
        return reserveDownloadTicket(
          req.user.id,
          req.params.id,
          req.body.path,
          releaseDownload,
        );
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

  app.get<{ Params: { id: string; ticket: string } }>(
    '/api/instances/:id/files/download-ticket/:ticket/status',
    async (req, reply) => {
      if (!getInstance(req.params.id)) return reply.code(404).send({ error: '实例不存在' });
      const status = getDownloadTicketStatus(req.params.ticket, req.user.id);
      if (!status) return reply.code(404).send({ error: '下载票据不存在或无权查看' });
      return status;
    },
  );

  app.delete<{ Params: { id: string; ticket: string } }>(
    '/api/instances/:id/files/download-ticket/:ticket',
    async (req, reply) => {
      const result = cancelDownloadTicketRoute(req.params.ticket, req.user.id, req.params.id);
      if (result.statusCode === 204) return reply.code(204).send();
      return reply.code(result.statusCode).send({ error: result.error });
    },
  );

  app.get<{ Params: { id: string }; Querystring: { path: string; ticket?: string } }>(
    '/api/instances/:id/files/download',
    { attachValidation: true, schema: { querystring: fileDownloadQuerySchema } },
    async (req, reply) => {
      if (req.validationError) return validationMessage(reply, '文件路径过长或格式不正确');
      const ticketParam = req.query.ticket;
      const hasTicket = typeof ticketParam === 'string' && ticketParam.length > 0;
      let activeTicket: string | null = hasTicket ? ticketParam : null;
      if (hasTicket) {
        const began = beginDownloadStream(ticketParam, req.params.id, req.query.path);
        if (!began) return reply.code(401).send({ error: '未授权' });
      }
      let releaseDownload: (() => void) | null = null;
      try {
        const abs = getAbsoluteFilePath(req.params.id, req.query.path);
        if (!hasTicket) {
          releaseDownload = acquireFileDownloadSlot();
        }
        const stream = fs.createReadStream(abs);
        let responseStarted = false;
        let cleaned = false;
        function releaseResources(): void {
          try {
            reply.raw.setTimeout(0);
          } catch {
            // 响应可能已经关闭。
          }
          reply.raw.off('finish', finishSuccess);
          reply.raw.off('close', onConnectionClosed);
          stream.off('error', onStreamError);
          stream.off('close', onStreamClosed);
          if (!stream.destroyed) stream.destroy();
        }
        function finishSuccess(): void {
          if (cleaned) return;
          cleaned = true;
          releaseDownload?.();
          if (activeTicket) {
            completeDownloadStream(activeTicket);
            activeTicket = null;
          }
          releaseResources();
        }
        function finishFailure(errorMessage: string): void {
          if (cleaned) return;
          cleaned = true;
          releaseDownload?.();
          if (activeTicket) {
            failDownloadStream(activeTicket, errorMessage);
            activeTicket = null;
          }
          releaseResources();
        }
        function onStreamError(error: Error): void {
          finishFailure(error.message || '文件读取失败');
          if (responseStarted && !reply.raw.destroyed) {
            reply.raw.destroy();
          }
        }
        function onStreamClosed(): void {
          if (stream.readableEnded) return;
          finishFailure('文件下载连接已中止');
          if (responseStarted && !reply.raw.destroyed) reply.raw.destroy();
        }
        function onConnectionClosed(): void {
          if (!reply.raw.writableFinished) finishFailure('文件下载连接已中止');
        }
        stream.once('close', onStreamClosed);
        stream.once('error', onStreamError);
        reply.raw.once('finish', finishSuccess);
        reply.raw.once('close', onConnectionClosed);
        reply.raw.setTimeout(config.fileDownloadIdleTimeoutMs, () => {
          if (cleaned) return;
          finishFailure('文件下载空闲超时');
          if (!reply.raw.destroyed) reply.raw.destroy();
        });
        if (reply.raw.destroyed) {
          finishFailure('文件下载连接已中止');
          throw new Error('文件下载连接已中止');
        }
        await waitForDownloadStreamOpen(stream);
        responseStarted = true;
        return reply
          .header('Content-Disposition', contentDispositionAttachment(path.basename(abs)))
          .type('application/octet-stream')
          .send(stream);
      } catch (err) {
        if (activeTicket) {
          const message = err instanceof Error ? err.message : '文件打开失败';
          failDownloadStream(activeTicket, message);
          activeTicket = null;
        }
        releaseDownload?.();
        if (isFileDownloadCapacityError(err)) {
          return reply.code(429).send({ error: err.message });
        }
        if (reply.raw.destroyed) return reply;
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
        const preview = previewServerPropertiesWrite(req.params.id, req.body);
        if (Buffer.byteLength(preview, 'utf8') > maxTextFileBytes) {
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
