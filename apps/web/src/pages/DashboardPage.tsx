import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { InstanceInfo } from '@mmd/shared';
import { api } from '../api';

const statusLabel: Record<string, string> = {
  stopped: '已停止',
  starting: '启动中',
  running: '运行中',
  stopping: '停止中',
  crashed: '已崩溃',
};

export function DashboardPage() {
  const [instances, setInstances] = useState<InstanceInfo[]>([]);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

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

  async function remove(id: string) {
    if (!confirm(instances.find((item) => item.id === id)?.requiresMigration ? '确定移除该实例记录？不会删除旧目录。' : '确定删除该实例及其全部文件？')) return;
    setBusyId(id);
    try {
      await api(`/api/instances/${id}`, { method: 'DELETE' });
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
              <strong>导入安装包</strong>
              <small>从本地 ZIP 创建实例</small>
            </span>
            <span className="quick-action-arrow" aria-hidden="true">›</span>
          </Link>
        </nav>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="panel">
        {instances.length === 0 ? (
          <p className="muted">暂无实例。可从「一键部署」下载 Paper / Fabric / Vanilla，或导入现有 zip。</p>
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
                  <td>
                    <Link to={`/instances/${inst.id}`}>{inst.name}</Link>
                  </td>
                  <td>{inst.coreType}</td>
                  <td>{inst.mcVersion || '-'}</td>
                  <td>
                    <span className={`badge ${inst.requiresMigration ? 'migration' : inst.status}`}>{inst.requiresMigration ? '待迁移' : statusLabel[inst.status] || inst.status}</span>
                  </td>
                  <td>
                    <div className="btn-row">
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
                        onClick={() => void act(inst.id, 'restart')}
                      >
                        重启
                      </button>
                      <button
                        className="btn btn-danger"
                        type="button"
                        disabled={busyId === inst.id}
                        onClick={() => void remove(inst.id)}
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
    </div>
  );
}
