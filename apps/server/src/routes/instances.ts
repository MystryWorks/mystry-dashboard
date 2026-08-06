import type { FastifyInstance } from 'fastify';
import type { CreateInstanceInput, UpdateInstanceInput } from '@mmd/shared';
import { createInstanceBodySchema, updateInstanceBodySchema } from '@mmd/shared';
import { config } from '../config.js';
import {
  adoptManagedDirectory,
  createInstance,
  deleteInstance,
  getInstance,
  getInstanceRow,
  listInstances,
  updateInstance,
} from '../services/instance-service.js';
import {
  isInstanceOperationConflictError,
  isInstanceStopPendingError,
  processManager,
} from '../services/process-manager.js';

const commandBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['command'],
  properties: {
    command: { type: 'string', minLength: 1, maxLength: config.maxCommandBytes },
  },
} as const;

function replyProcessManagerError(
  reply: { code: (status: number) => { send: (body: unknown) => unknown } },
  err: unknown,
) {
  if (isInstanceStopPendingError(err)) {
    return reply.code(202).send({
      code: 'INSTANCE_STOP_PENDING',
      error: err.message,
      status: 'stopping',
      stillStopping: true as const,
    });
  }
  if (isInstanceOperationConflictError(err)) {
    return reply.code(409).send({
      code: 'INSTANCE_OPERATION_CONFLICT',
      error: err.message,
    });
  }
  return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
}

export async function instanceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get('/api/instances', async () => listInstances());

  app.get<{ Params: { id: string } }>('/api/instances/:id', async (req, reply) => {
    const inst = getInstance(req.params.id);
    if (!inst) return reply.code(404).send({ error: '实例不存在' });
    return inst;
  });

  app.post<{
    Body: CreateInstanceInput;
  }>('/api/instances', { attachValidation: true, schema: { body: createInstanceBodySchema } }, async (req, reply) => {
    if (req.validationError) {
      return reply.code(400).send({ error: '实例参数包含不支持的字段或格式不正确' });
    }
    if (!req.body?.name?.trim()) {
      return reply.code(400).send({ error: '名称不能为空' });
    }
    try {
      return createInstance(req.body);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.patch<{
    Params: { id: string };
    Body: UpdateInstanceInput;
  }>('/api/instances/:id', { attachValidation: true, schema: { body: updateInstanceBodySchema } }, async (req, reply) => {
    if (req.validationError) {
      return reply.code(400).send({ error: '实例参数包含不支持的字段或格式不正确' });
    }
    try {
      return updateInstance(req.params.id, req.body);
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post<{ Params: { id: string } }>(
    '/api/instances/:id/adopt-managed-directory',
    async (req, reply) => {
      try {
        return adoptManagedDirectory(req.params.id);
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.delete<{ Params: { id: string } }>('/api/instances/:id', async (req, reply) => {
    try {
      deleteInstance(req.params.id);
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post<{ Params: { id: string } }>('/api/instances/:id/start', async (req, reply) => {
    const row = getInstanceRow(req.params.id);
    if (!row) return reply.code(404).send({ error: '实例不存在' });
    try {
      await processManager.start(row);
      return getInstance(row.id);
    } catch (err) {
      return replyProcessManagerError(reply, err);
    }
  });

  app.post<{ Params: { id: string }; Querystring: { force?: string } }>(
    '/api/instances/:id/stop',
    async (req, reply) => {
      try {
        await processManager.stop(req.params.id, req.query.force === '1');
        return getInstance(req.params.id);
      } catch (err) {
        return replyProcessManagerError(reply, err);
      }
    },
  );

  app.post<{ Params: { id: string } }>('/api/instances/:id/restart', async (req, reply) => {
    const row = getInstanceRow(req.params.id);
    if (!row) return reply.code(404).send({ error: '实例不存在' });
    try {
      await processManager.restart(row);
      return getInstance(row.id);
    } catch (err) {
      return replyProcessManagerError(reply, err);
    }
  });

  app.post<{ Params: { id: string }; Body: { command: string } }>(
    '/api/instances/:id/command',
    { attachValidation: true, schema: { body: commandBodySchema } },
    async (req, reply) => {
      if (req.validationError) {
        return reply.code(400).send({ error: '指令过长、为空或包含不支持的字段' });
      }
      try {
        processManager.sendCommand(req.params.id, req.body.command);
        return { ok: true };
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );
}
