import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import type { TaskInfo } from '@mmd/shared';
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

const statusBadge: Record<TaskInfo['status'], string> = {
  pending: 'stopping',
  running: 'running',
  completed: 'stopped',
  failed: 'crashed',
};

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * 任务中心入口：铃铛 + 进行中数量徽标 + 任务列表面板。
 * placement 控制面板展开方向（侧边栏向上、顶栏向下）。
 */
export function TaskCenter({ placement }: { placement: 'sidebar' | 'topbar' }) {
  const { tasks, error, loading, activeCount, lastSuccessAt, retry } = useTaskCenter();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  // 面板用 fixed 定位并跟随按钮坐标：侧边栏有 overflow:auto，
  // absolute 定位会被滚动容器裁切，导致面板显示不全。
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    if (!open) return;
    function updatePosition() {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const gap = 8;
      if (placement === 'topbar') {
        setPanelStyle({
          top: rect.bottom + gap,
          right: Math.max(8, window.innerWidth - rect.right),
        });
      } else {
        setPanelStyle({
          left: Math.max(8, Math.min(rect.left, window.innerWidth - 368)),
          bottom: window.innerHeight - rect.top + gap,
        });
      }
    }
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, placement]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        toggleRef.current?.focus();
      }
    }
    function onMouseDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [open]);

  const stale = Boolean(error);

  return (
    <div className={`task-center task-center-${placement}`} ref={rootRef}>
      <button
        ref={toggleRef}
        type="button"
        className="task-center-toggle"
        aria-label={open ? '关闭任务中心' : `打开任务中心，${activeCount} 个任务进行中`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={18} aria-hidden="true" />
        {activeCount > 0 && <span className="task-center-badge">{activeCount}</span>}
      </button>

      {open && (
        <div
          id={panelId}
          ref={panelRef}
          className="task-panel"
          style={panelStyle}
          role="dialog"
          aria-label="任务中心"
          tabIndex={-1}
        >
          <header className="task-panel-header">
            <h2>任务中心</h2>
            {activeCount > 0 && <span className="muted">{activeCount} 个进行中</span>}
          </header>
          {stale && (
            <div className="task-panel-stale" role="status">
              <p className="error">状态可能已过期：{error}</p>
              {lastSuccessAt && (
                <p className="muted">上次成功刷新：{formatTime(lastSuccessAt)}</p>
              )}
              <button className="btn btn-ghost" type="button" onClick={() => retry()}>
                重试刷新
              </button>
            </div>
          )}
          {loading && <p className="muted">正在读取任务…</p>}
          {!loading && !error && tasks.length === 0 && (
            <p className="muted">暂无任务。部署或导入实例后会显示在这里。</p>
          )}
          <ul className="task-list">
            {tasks.map((task) => (
              <li key={task.id} className="task-item">
                <div className="task-item-head">
                  <strong>{typeLabel[task.type]}</strong>
                  <span className={`badge ${statusBadge[task.status]}`}>{statusLabel[task.status]}</span>
                  <time className="muted">{formatTime(task.createdAt)}</time>
                </div>
                <p className="task-item-message">{task.message}</p>
                {(task.status === 'pending' || task.status === 'running') && (
                  <div
                    className="task-progress"
                    role="progressbar"
                    aria-valuenow={task.progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <span style={{ width: `${Math.min(100, Math.max(0, task.progress))}%` }} />
                  </div>
                )}
                {task.status === 'failed' && task.error && (
                  <p className="task-item-error" title={task.error}>{task.error}</p>
                )}
                {task.status === 'completed' && task.result?.instanceId && (
                  <Link
                    className="task-item-link"
                    to={`/instances/${task.result.instanceId}`}
                    onClick={() => setOpen(false)}
                  >
                    查看实例 →
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
