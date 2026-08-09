import { useCallback, useEffect, useRef, useState } from 'react';
import type { NodeInfo } from '@mmd/shared';
import { REMOTE_NODE_CREATION_ENABLED } from '@mmd/shared';
import { api } from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';

const statusLabel: Record<string, string> = {
  online: '在线',
  offline: '离线',
};

type LoadState = 'loading' | 'loaded' | 'error';

export function NodesPage() {
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<NodeInfo | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const latestLoadRequestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++latestLoadRequestRef.current;
    try {
      const result = await api<NodeInfo[]>('/api/nodes');
      if (requestId !== latestLoadRequestRef.current) return;
      setNodes(result);
      setLoadState('loaded');
      setLoadError('');
    } catch (err) {
      if (requestId !== latestLoadRequestRef.current) return;
      setLoadError(err instanceof Error ? err.message : String(err));
      setLoadState((current) => (current === 'loaded' ? 'loaded' : 'error'));
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [load]);

  function retryLoad(): void {
    setLoadError('');
    setLoadState('loading');
    void load();
  }

  function openDeleteDialog(node: NodeInfo): void {
    setDeleteError('');
    setDeleteTarget(node);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setBusyId(target.id);
    setDeleteError('');
    try {
      await api(`/api/nodes/${target.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
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

      {loadError && (
        <p className="error" role="alert">
          {loadError}
          {loadState === 'loaded' ? ' 当前正在显示上次成功加载的节点数据。' : ''}
        </p>
      )}

      <div className="panel" style={{ marginBottom: '1.25rem' }}>
        {loadState === 'loading' ? (
          <p className="muted" role="status">正在加载节点列表…</p>
        ) : loadState === 'error' ? (
          <div role="alert">
            <p className="muted">节点列表暂时不可用，请检查面板连接后重试。</p>
            <button className="btn btn-ghost" type="button" onClick={retryLoad}>
              重新加载
            </button>
          </div>
        ) : nodes.length === 0 ? (
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
                        onClick={() => openDeleteDialog(node)}
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

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`删除节点「${deleteTarget?.name ?? ''}」？`}
        description={
          <>
            <p>仅可删除没有关联实例的远程节点。删除后无法恢复。</p>
            {deleteError && <p className="error" role="alert">{deleteError}</p>}
          </>
        }
        confirmLabel="确认删除"
        danger
        busy={busyId === deleteTarget?.id}
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteError('');
        }}
      />
    </div>
  );
}
