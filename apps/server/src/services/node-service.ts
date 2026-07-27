import crypto from 'node:crypto';
import { nanoid } from 'nanoid';
import type { CreateNodeInput, NodeInfo, NodeSecretResult, UpdateNodeInput } from '@mmd/shared';
import { LOCAL_NODE_ID, REMOTE_NODE_CREATION_ENABLED } from '@mmd/shared';
import { getDb, type NodeRow } from '../db.js';
import { nowIso } from '../utils/path.js';
import { nodeRegistry } from './node-registry.js';

/** 节点密钥使用 sha256 摘要存储：密钥本身是高熵随机串，无需 bcrypt 慢哈希 */
function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

function generateSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

function rowToInfo(row: NodeRow): NodeInfo {
  const instanceCount = (
    getDb().prepare('SELECT COUNT(*) as c FROM instances WHERE node_id = ?').get(row.id) as {
      c: number;
    }
  ).c;
  return {
    id: row.id,
    name: row.name,
    isLocal: Boolean(row.is_local),
    status: nodeRegistry.getStatus(row.id),
    lastSeenAt: nodeRegistry.getLastSeenAt(row.id),
    hostInfo: nodeRegistry.getHostInfo(row.id) ?? parseHostInfo(row.host_info),
    instanceCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseHostInfo(raw: string | null): NodeInfo['hostInfo'] {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function listNodes(): NodeInfo[] {
  const rows = getDb().prepare('SELECT * FROM nodes ORDER BY is_local DESC, created_at ASC').all() as NodeRow[];
  return rows.map(rowToInfo);
}

export function getNode(id: string): NodeInfo | null {
  const row = getNodeRow(id);
  return row ? rowToInfo(row) : null;
}

export function getNodeRow(id: string): NodeRow | null {
  const row = getDb().prepare('SELECT * FROM nodes WHERE id = ?').get(id) as NodeRow | undefined;
  return row ?? null;
}

/** 创建远程节点，返回节点信息与仅展示一次的密钥（供部署 Agent 时填入配置） */
export function createNode(input: CreateNodeInput): NodeSecretResult {
  if (!REMOTE_NODE_CREATION_ENABLED) {
    throw new Error('当前版本暂不支持创建远程节点，敬请期待 Agent 接入后开放');
  }
  if (!input.name?.trim()) {
    throw new Error('节点名称不能为空');
  }
  const id = nanoid(12);
  const now = nowIso();
  const secret = generateSecret();
  getDb()
    .prepare(
      `INSERT INTO nodes (id, name, secret_hash, is_local, host_info, created_at, updated_at)
       VALUES (?, ?, ?, 0, NULL, ?, ?)`,
    )
    .run(id, input.name.trim(), hashSecret(secret), now, now);
  return { node: getNode(id)!, secret };
}

export function updateNode(id: string, input: UpdateNodeInput): NodeInfo {
  const existing = getNodeRow(id);
  if (!existing) throw new Error('节点不存在');
  if (input.name !== undefined && !input.name.trim()) {
    throw new Error('节点名称不能为空');
  }
  getDb()
    .prepare('UPDATE nodes SET name = ?, updated_at = ? WHERE id = ?')
    .run(input.name?.trim() ?? existing.name, nowIso(), id);
  return getNode(id)!;
}

export function deleteNode(id: string): void {
  const existing = getNodeRow(id);
  if (!existing) return;
  if (existing.is_local) {
    throw new Error('本机节点不可删除');
  }
  const { c } = getDb()
    .prepare('SELECT COUNT(*) as c FROM instances WHERE node_id = ?')
    .get(id) as { c: number };
  if (c > 0) {
    throw new Error('该节点下还有实例，请先迁移或删除这些实例');
  }
  getDb().prepare('DELETE FROM nodes WHERE id = ?').run(id);
  nodeRegistry.markOffline(id);
}

/** 重置节点密钥；旧密钥立即失效，新密钥仅返回一次 */
export function resetNodeSecret(id: string): NodeSecretResult {
  const existing = getNodeRow(id);
  if (!existing) throw new Error('节点不存在');
  if (existing.is_local) {
    throw new Error('本机节点无需密钥');
  }
  const secret = generateSecret();
  getDb()
    .prepare('UPDATE nodes SET secret_hash = ?, updated_at = ? WHERE id = ?')
    .run(hashSecret(secret), nowIso(), id);
  return { node: getNode(id)!, secret };
}

/**
 * 校验节点密钥是否正确（供阶段二 Agent 反向连接鉴权使用）。
 */
export function verifyNodeSecret(id: string, secret: string): boolean {
  const row = getNodeRow(id);
  if (!row || row.is_local) return false;
  return row.secret_hash === hashSecret(secret);
}

export function nodeExists(id: string): boolean {
  return Boolean(getNodeRow(id));
}

export { LOCAL_NODE_ID };
