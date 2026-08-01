import { useCallback, useEffect, useState } from 'react';
import type { NodeInfo } from '@mmd/shared';
import { REMOTE_NODE_CREATION_ENABLED } from '@mmd/shared';
import { api } from '../api';

const statusLabel: Record<string, string> = {
  online: '在线',
  offline: '离线',
};

export function NodesPage() {
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setNodes(await api<NodeInfo[]>('/api/nodes'));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [load]);

  async function onDelete(id: string) {
    if (!confirm('确定删除该节点？（该节点下必须没有实例）')) return;
    setBusyId(id);
    try {
      await api(`/api/nodes/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  const remoteNodes = nodes.filter((n) => !n.isLocal);

  return (
    <div>
      <h1 className="page-title">节点管理</h1>
      <p className="page-desc">
        「本机节点」代表面板自身的执行能力，当前版本所有实例均运行在本机。
        多机 Agent 纳管尚未开放；创建远程节点与远程部署将在后续版本提供。
      </p>

      {error && <p className="error">{error}</p>}

      <div className="panel" style={{ marginBottom: '1.25rem' }}>
        {nodes.length === 0 ? (
          <p className="muted">暂无节点数据。</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>名称</th>
                <th>类型</th>
                <th>状态</th>
                <th>实例数</th>
                <th>最近心跳</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((node) => (
                <tr key={node.id}>
                  <td data-label="名称">{node.name}</td>
                  <td data-label="类型">{node.isLocal ? '本机' : '远程（未开放）'}</td>
                  <td data-label="状态">
                    <span className={`badge ${node.status === 'online' ? 'running' : 'stopped'}`}>
                      {statusLabel[node.status] || node.status}
                    </span>
                  </td>
                  <td data-label="实例数">{node.instanceCount}</td>
                  <td data-label="最近心跳" className="muted">
                    {node.lastSeenAt ? new Date(node.lastSeenAt).toLocaleString() : '—'}
                  </td>
                  <td data-label="操作">
                    {!node.isLocal && (
                      <button
                        className="btn btn-danger"
                        type="button"
                        disabled={busyId === node.id || node.instanceCount > 0}
                        onClick={() => void onDelete(node.id)}
                      >
                        删除
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!REMOTE_NODE_CREATION_ENABLED && (
        <div className="panel" style={{ maxWidth: 560 }}>
          <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.05rem' }}>远程节点</h2>
          <p className="muted" style={{ margin: 0 }}>
            当前版本不支持新增远程节点。
            {remoteNodes.length > 0
              ? '下方列表中若仍有历史远程节点记录，可在确认无关联实例后删除。'
              : 'Agent 连接与远程实例管理开放后，将在此提供注册入口。'}
          </p>
        </div>
      )}
    </div>
  );
}
