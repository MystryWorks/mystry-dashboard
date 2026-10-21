import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Clock, RefreshCw, X } from 'lucide-react';
import type { TaskInfo } from '@mystry/shared';
import { useTaskCenter } from '../task-center-store';

const typeLabel: Record<TaskInfo['type'], string> = {
  download: '下载核心',
  extract: '解压文件',
  deploy: '部署实例',
  import: '导入服务端',
};

const statusLabel: Record<TaskInfo['status'], string> = {
  pending: '排队中',
  running: '进行中',
  completed: '已完成',
  failed: '失败',
};

const statusColor: Record<TaskInfo['status'], string> = {
  pending: 'var(--warn)',
  running: 'var(--accent)',
  completed: 'var(--ok)',
  failed: 'var(--danger)',
};

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * 任务中心抽屉式组件：
 * 采用原型的高保真设计，从右侧滑出显示异步任务队列与进度条。
 */
export function TaskCenter({ placement = 'topbar' }: { placement?: 'sidebar' | 'topbar' }) {
  const { tasks, error, loading, activeCount, lastSuccessAt, retry } = useTaskCenter();
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDialogElement>(null);
  const drawerId = useId();

  useEffect(() => {
    const dialog = drawerRef.current;
    if (!open || !dialog) return;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, [open]);

  function closeDrawer() {
    drawerRef.current?.close();
    setOpen(false);
    toggleRef.current?.focus();
  }

  const stale = Boolean(error);

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        className={`btn ${placement === 'sidebar' ? 'btn-icon' : ''}`}
        aria-label={open ? '关闭任务中心' : `打开任务中心，${activeCount} 个任务进行中`}
        aria-expanded={open}
        aria-controls={drawerId}
        onClick={() => setOpen((value) => !value)}
        title="后台任务中心"
      >
        <Clock size={16} aria-hidden="true" />
        {placement !== 'sidebar' && <span>任务队列</span>}
        {activeCount > 0 ? (
          <span
            style={{
              background: 'var(--accent)',
              color: '#fff',
              fontSize: '0.72rem',
              padding: '2px 6px',
              borderRadius: '8px',
              lineHeight: 1,
              fontWeight: 600,
            }}
          >
            {activeCount}
          </span>
        ) : tasks.length > 0 ? (
          <span
            style={{
              background: 'var(--badge-bg)',
              color: 'var(--text-muted)',
              fontSize: '0.72rem',
              padding: '2px 6px',
              borderRadius: '8px',
              lineHeight: 1,
            }}
          >
            {tasks.length}
          </span>
        ) : null}
      </button>

      {createPortal(<dialog
        id={drawerId}
        ref={drawerRef}
        className="task-drawer"
        onCancel={(event) => { event.preventDefault(); closeDrawer(); }}
        onClose={() => {
          // 忽略快速重开或严格模式清理留下的旧关闭事件。
          if (drawerRef.current?.open) return;
          setOpen(false);
          toggleRef.current?.focus();
        }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDrawer();
        }}
        aria-label="后台异步任务中心"
        tabIndex={-1}
      >
        <div className="drawer-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Clock size={18} style={{ color: 'var(--accent)' }} />
            <span style={{ fontWeight: 700, fontSize: '1rem' }}>后台异步任务中心</span>
            {activeCount > 0 && (
              <span className="tag-badge" style={{ fontSize: '0.72rem', height: '22px' }}>
                {activeCount} 进行中
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              className="btn btn-icon"
              type="button"
              title="刷新任务"
              onClick={() => retry()}
              style={{ width: 32, height: 32 }}
            >
              <RefreshCw size={14} />
            </button>
            <button
              className="btn btn-icon"
              type="button"
              title="关闭"
              onClick={closeDrawer}
              style={{ width: 32, height: 32 }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="drawer-body">
          {stale && (
            <div
              style={{
                padding: '12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--danger)',
                background: 'var(--danger-subtle)',
                fontSize: '0.84rem',
              }}
            >
              <p style={{ color: 'var(--danger)', margin: 0, fontWeight: 600 }}>状态可能已过期：{error}</p>
              {lastSuccessAt && (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: 4 }}>
                  上次成功同步：{formatTime(lastSuccessAt)}
                </p>
              )}
            </div>
          )}

          {loading && <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>正在读取任务列表…</p>}

          {!loading && !error && tasks.length === 0 && (
            <div
              style={{
                padding: '36px 16px',
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: '0.88rem',
              }}
            >
              暂无后台任务。在发起一键部署或导入实例后，进度将实时流式更新在此处。
            </div>
          )}

          {tasks.map((task) => (
            <div key={task.id} className="task-card">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '0.88rem',
                  fontWeight: 600,
                }}
              >
                <span>{typeLabel[task.type]}</span>
                <span style={{ color: statusColor[task.status], fontSize: '0.8rem' }}>
                  {task.status === 'running'
                    ? `${task.progress}% 进行中`
                    : statusLabel[task.status]}
                </span>
              </div>

              {(task.status === 'pending' || task.status === 'running') && (
                <div className="metric-bar" style={{ height: 4 }} role="progressbar" aria-label={`${typeLabel[task.type]}进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.max(0, task.progress))}>
                  <div
                    className="metric-bar-fill"
                    style={{
                      width: `${Math.min(100, Math.max(0, task.progress))}%`,
                    }}
                  />
                </div>
              )}

              {task.message && (
                <p
                  style={{
                    fontSize: '0.78rem',
                    color: 'var(--text-muted)',
                    margin: 0,
                    lineHeight: 1.4,
                  }}
                >
                  {task.message}
                </p>
              )}

              {task.status === 'failed' && task.error && (
                <p
                  style={{
                    fontSize: '0.78rem',
                    color: 'var(--danger)',
                    margin: 0,
                    overflowWrap: 'anywhere',
                  }}
                >
                  {task.error}
                </p>
              )}

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '0.72rem',
                  color: 'var(--text-muted)',
                  marginTop: 2,
                }}
              >
                <time>{formatTime(task.createdAt)}</time>
                {task.result?.instanceId && (task.status === 'completed' || task.status === 'failed') && (
                  <Link
                    to={`/instances/${task.result.instanceId}`}
                    onClick={closeDrawer}
                    style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}
                  >
                    查看实例 →
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      </dialog>, document.body)}
    </>
  );
}
