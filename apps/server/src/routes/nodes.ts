import type { FastifyInstance } from 'fastify';
import {
  REMOTE_NODE_CREATION_ENABLED,
  createNodeBodySchema,
  updateNodeBodySchema,
} from '@mmd/shared';
import {
  createNode,
  deleteNode,
  getNode,
  listNodes,
  resetNodeSecret,
  updateNode,
} from '../services/node-service.js';

/**
 * 节点管理 API（阶段一）：
 * - 面板启动时会自动创建/保留一个内置本机节点（id='local'），代表当前的本机 spawn 执行能力；
 * - 远程节点创建由 REMOTE_NODE_CREATION_ENABLED 控制；当前关闭，避免暗示多机已可用；
 * - 远程节点的真实 Agent 反向连接、指令转发将在阶段二/三接入。
 */
export async function nodeRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get('/api/nodes', async () => listNodes());

  app.get<{ Params: { id: string } }>('/api/nodes/:id', async (req, reply) => {
    const node = getNode(req.params.id);
    if (!node) return reply.code(404).send({ error: '节点不存在' });
    return node;
  });

  app.post<{ Body: { name: string } }>(
    '/api/nodes',
    { attachValidation: true, schema: { body: createNodeBodySchema } },
    async (req, reply) => {
      if (!REMOTE_NODE_CREATION_ENABLED) {
        return reply.code(403).send({ error: '当前版本暂不支持创建远程节点，敬请期待 Agent 接入后开放' });
      }
      if (req.validationError) {
        return reply.code(400).send({ error: '节点参数包含不支持的字段或格式不正确' });
      }
      try {
        return createNode(req.body);
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.patch<{ Params: { id: string }; Body: { name?: string } }>(
    '/api/nodes/:id',
    { attachValidation: true, schema: { body: updateNodeBodySchema } },
    async (req, reply) => {
      if (req.validationError) {
        return reply.code(400).send({ error: '节点参数包含不支持的字段或格式不正确' });
      }
      try {
        return updateNode(req.params.id, req.body);
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.delete<{ Params: { id: string } }>('/api/nodes/:id', async (req, reply) => {
    try {
      deleteNode(req.params.id);
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post<{ Params: { id: string } }>('/api/nodes/:id/secret/reset', async (req, reply) => {
    if (!REMOTE_NODE_CREATION_ENABLED) {
      return reply.code(403).send({ error: '当前版本暂不支持远程节点密钥操作' });
    }
    try {
      return resetNodeSecret(req.params.id);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
