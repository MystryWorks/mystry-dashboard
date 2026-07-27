import { EventEmitter } from 'node:events';
import os from 'node:os';
import type { NodeHostInfo, NodeStatus } from '@mmd/shared';
import { LOCAL_NODE_ID } from '@mmd/shared';

/**
 * 节点运行期状态注册表（内存态，重启面板即重置）。
 *
 * 设计与 ProcessManager 保持一致：数据库只存节点的静态元数据（名称、密钥哈希），
 * 在线状态/心跳/主机信息属于运行期信息，不写库。
 *
 * 阶段一：仅本机节点会被标记为 online（面板自身即本机执行能力）；
 * 远程节点的真实上线状态将在阶段二/三接入 Agent WebSocket 反向连接后由
 * markOnline/markOffline 驱动。
 */
class NodeRegistry extends EventEmitter {
  private online = new Map<string, { lastSeenAt: string; hostInfo: NodeHostInfo | null }>();

  constructor() {
    super();
    // 本机节点视为面板自身，始终在线
    this.markOnline(LOCAL_NODE_ID, {
      platform: os.platform(),
      arch: os.arch(),
      cpuCount: os.cpus().length,
      totalMemMb: Math.round(os.totalmem() / 1024 / 1024),
    });
  }

  getStatus(nodeId: string): NodeStatus {
    if (nodeId === LOCAL_NODE_ID) return 'online';
    return this.online.has(nodeId) ? 'online' : 'offline';
  }

  getLastSeenAt(nodeId: string): string | null {
    return this.online.get(nodeId)?.lastSeenAt ?? null;
  }

  getHostInfo(nodeId: string): NodeHostInfo | null {
    return this.online.get(nodeId)?.hostInfo ?? null;
  }

  markOnline(nodeId: string, hostInfo: NodeHostInfo | null = null): void {
    this.online.set(nodeId, { lastSeenAt: new Date().toISOString(), hostInfo });
    this.emit('status', nodeId, 'online' satisfies NodeStatus);
  }

  markOffline(nodeId: string): void {
    if (nodeId === LOCAL_NODE_ID) return; // 本机节点不可下线
    this.online.delete(nodeId);
    this.emit('status', nodeId, 'offline' satisfies NodeStatus);
  }

  isOnline(nodeId: string): boolean {
    return this.getStatus(nodeId) === 'online';
  }
}

export const nodeRegistry = new NodeRegistry();
