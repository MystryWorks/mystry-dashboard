import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { InstanceInfo } from '@mmd/shared';
import { api } from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';

const statusLabel: Record<string, string> = {
  stopped: '已停止',
  starting: '启动中',
  running: '运行中',
  stopping: '停止中',
  crashed: '已崩溃',
};

/** 进程仍可能存活的状态：此时禁止删除，避免删除运行中实例的目录。 */
function isAlive(status: InstanceInfo['status']): boolean {
  return status === 'running' || status === 'starting' || status === 'stopping';
}

export function DashboardPage() {
  const [instances, setInstances] = useState<InstanceInfo[]>([]);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [restartTarget, setRestartTarget] = useState<InstanceInfo | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InstanceInfo | null>(null);

  const load = useCallback(async () => {
    try {
      setInstances(await api<InstanceInfo[]>('/api/instances'));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [load]);

  async function act(id: string, action: 'start' | 'stop' | 'restart') {
    setBusyId(id);
    try {
      await api(`/api/instances/${id}/${action}`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function confirmRestart() {
    if (!restartTarget) return;
    const target = restartTarget;
    setRestartTarget(null);
    await act(target.id, 'restart');
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setBusyId(target.id);
    try {
      await api(`/api/instances/${target.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <header className="dashboard-header">
        <div>
          <h1 className="page-title">实例总览</h1>
          <p className="page-desc">管理本机 Minecraft 服务端进程。</p>
        </div>
        <nav className="dashboard-actions" aria-label="创建实例">
          <Link className="quick-action quick-action-primary" to="/deploy">
            <span className="quick-action-icon" aria-hidden="true">＋</span>
            <span className="quick-action-copy">
              <strong>一键部署</strong>
              <small>在线选择服务端核心</small>
            </span>
            <span className="quick-action-arrow" aria-hidden="true">›</span>
          </Link>
          <Link className="quick-action" to="/import">
            <span className="quick-action-icon" aria-hidden="true">⇩</span>
            <span className="quick-action-copy">
              <strong>导入已有服务端</strong>
              <small>接管同机目录或上传 ZIP</small>
            </span>
            <span className="quick-action-arrow" aria-hidden="true">›</span>
          </Link>
        </nav>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="panel">
        {instances.length === 0 ? (
          <p className="muted">暂无实例。可从「一键部署」下载核心，或导入面板外已有的服务端。</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>名称</th>
                <th>核心</th>
                <th>版本</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {instances.map((inst) => (
                <tr key={inst.id}>
                  <td data-label="名称">
                    <Link to={`/instances/${inst.id}`}>{inst.name}</Link>
                  </td>
                  <td data-label="核心">{inst.coreType}</td>
                  <td data-label="版本">{inst.mcVersion || '-'}</td>
                  <td data-label="状态">
                    <span className={`badge ${inst.requiresMigration ? 'migration' : inst.status}`}>{inst.requiresMigration ? '待迁移' : statusLabel[inst.status] || inst.status}</span>
                  </td>
                  <td data-label="操作">
                    <div className="btn-row">
                      <Link className="btn btn-ghost" to={`/instances/${inst.id}`}>
                        查看实例
                      </Link>
                      <button
                        className="btn"
                        type="button"
                        disabled={busyId === inst.id || inst.requiresMigration || inst.status === 'running'}
                        onClick={() => void act(inst.id, 'start')}
                      >
                        启动
                      </button>
                      <button
                        className="btn btn-ghost"
                        type="button"
                        disabled={busyId === inst.id || inst.requiresMigration || inst.status === 'stopped'}
                        onClick={() => void act(inst.id, 'stop')}
                      >
                        停止
                      </button>
                      <button
                        className="btn btn-ghost"
                        type="button"
                        disabled={busyId === inst.id || inst.requiresMigration}
                        onClick={() => setRestartTarget(inst)}
                      >
                        重启
                      </button>
                      <button
                        className="btn btn-danger"
                        type="button"
                        disabled={busyId === inst.id || (!inst.requiresMigration && isAlive(inst.status))}
                        title={
                          !inst.requiresMigration && isAlive(inst.status)
                            ? '实例仍在运行，请先停止后再删除'
                            : undefined
                        }
                        onClick={() => setDeleteTarget(inst)}
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ConfirmDialog
        open={restartTarget !== null}
        title={`重启实例「${restartTarget?.name ?? ''}」？`}
        description="重启会中断当前游戏进程并断开所有在线玩家，未保存的世界数据可能丢失。"
        confirmLabel="确认重启"
        busy={busyId === restartTarget?.id}
        onConfirm={() => void confirmRestart()}
        onCancel={() => setRestartTarget(null)}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        title={deleteTarget?.requiresMigration ? `移除实例记录「${deleteTarget?.name ?? ''}」？` : `删除实例「${deleteTarget?.name ?? ''}」？`}
        description={
          deleteTarget?.requiresMigration
            ? '仅移除面板中的实例记录，不会删除旧目录中的任何文件。'
            : '将永久删除该实例目录及其全部文件（世界、配置、模组），此操作不可恢复。'
        }
        confirmLabel={deleteTarget?.requiresMigration ? '移除记录' : '永久删除'}
        danger
        busy={busyId === deleteTarget?.id}
        requireText={deleteTarget?.requiresMigration ? undefined : deleteTarget?.name}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
