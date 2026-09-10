import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity,
  FolderDown,
  Layers,
  MoreVertical,
  Play,
  Plus,
  Power,
  RotateCcw,
  Server,
  Trash2,
  Zap,
} from 'lucide-react';
import type { InstanceInfo } from '@mmd/shared';
import { isInstanceStopPendingResult } from '@mmd/shared';
import { api } from '../api';
import { HostMetricCards, processMetric, useDashboardMetrics } from '../components/DashboardMetrics';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { JavaRuntimeSelect } from '../components/JavaRuntimeSelect';
import { JvmSettingsEditor } from '../components/JvmSettingsEditor';

const statusLabel: Record<string, string> = {
  stopped: '已停止',
  starting: '启动中',
  running: '运行中',
  stopping: '停止中',
  crashed: '已崩溃',
};

type LoadState = 'loading' | 'loaded' | 'error';

function canStartInstance(status: InstanceInfo['status']): boolean {
  return status === 'stopped' || status === 'crashed';
}

function canStopInstance(status: InstanceInfo['status']): boolean {
  return status === 'running';
}

function isLifecycleBusy(status: InstanceInfo['status']): boolean {
  return status === 'starting' || status === 'stopping';
}

function isAlive(status: InstanceInfo['status']): boolean {
  return status === 'running' || status === 'starting' || status === 'stopping';
}

function extractXmx(jvmArgs: string): string {
  const match = jvmArgs.match(/-Xmx(\w+)/i);
  return match ? match[1].toUpperCase() : '默认';
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { metrics, error: metricsError, busy: metricsBusy, refresh: refreshMetrics } = useDashboardMetrics();
  const [abnormalOnly, setAbnormalOnly] = useState(false);
  const [instances, setInstances] = useState<InstanceInfo[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const latestLoadRequestRef = useRef(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [restartTarget, setRestartTarget] = useState<InstanceInfo | null>(null);
  const [forceStopTarget, setForceStopTarget] = useState<InstanceInfo | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InstanceInfo | null>(null);
  const [emptyOpen, setEmptyOpen] = useState(false);
  const [emptyName, setEmptyName] = useState('自定义 Jar 实例');
  const [emptyJvm, setEmptyJvm] = useState('-Xms1G -Xmx2G');
  const [emptyEula, setEmptyEula] = useState(true);
  const [emptyJavaRuntimeId, setEmptyJavaRuntimeId] = useState<string | null>(null);
  const [emptyJavaMajor, setEmptyJavaMajor] = useState<number | null>(null);
  const [emptyJvmValid, setEmptyJvmValid] = useState(true);
  const [emptyBusy, setEmptyBusy] = useState(false);

  const load = useCallback(async () => {
    const requestId = ++latestLoadRequestRef.current;
    try {
      const result = await api<InstanceInfo[]>('/api/instances');
      if (requestId !== latestLoadRequestRef.current) return;
      setInstances(result);
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
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [load]);

  function retryLoad(): void {
    setLoadError('');
    setLoadState('loading');
    void load();
  }

  async function act(id: string, action: 'start' | 'stop' | 'restart', options?: { force?: boolean }) {
    setBusyId(id);
    setActionError('');
    try {
      const query = action === 'stop' && options?.force ? '?force=1' : '';
      const result = await api<InstanceInfo | import('@mmd/shared').InstanceStopPendingResult>(
        `/api/instances/${id}/${action}${query}`,
        { method: 'POST' },
      );
      if (isInstanceStopPendingResult(result)) {
        setActionError(result.error || '服务仍在保存，请等待或选择强制停止');
      } else {
        setActionError('');
      }
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
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

  async function confirmForceStop() {
    if (!forceStopTarget) return;
    const target = forceStopTarget;
    setForceStopTarget(null);
    await act(target.id, 'stop', { force: true });
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    setBusyId(target.id);
    setActionError('');
    try {
      await api(`/api/instances/${target.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function confirmCreateEmpty() {
    setEmptyBusy(true);
    setActionError('');
    try {
      const inst = await api<InstanceInfo>('/api/instances', {
        method: 'POST',
        json: {
          name: emptyName,
          coreType: 'custom',
          jvmArgs: emptyJvm,
          acceptEula: emptyEula,
          javaRuntimeId: emptyJavaRuntimeId,
        },
      });
      setEmptyOpen(false);
      navigate(`/instances/${inst.id}/files`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setEmptyBusy(false);
    }
  }

  // 统计指标
  const runningCount = useMemo(() => instances.filter((i) => i.status === 'running').length, [instances]);
  const stoppedCount = useMemo(() => instances.filter((i) => i.status === 'stopped').length, [instances]);
  const abnormalCount = useMemo(() => instances.filter((i) => i.status === 'crashed' || i.requiresMigration).length, [instances]);
  const runningRatio = instances.length > 0 ? (runningCount / instances.length) * 100 : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* 顶部指标卡片组 (Metric Grid) */}
      <div className="metric-grid dashboard-metrics">
        <div className="metric-card">
          <div className="metric-header">
            <span>实例状态</span>
            <Activity size={18} style={{ color: 'var(--ok)' }} />
          </div>
          <div className="metric-value">
            {loadState === 'loaded' ? `${runningCount} / ${instances.length}` : '—'} <span className="metric-unit">运行中</span>
          </div>
          <div className="metric-bar">
            <div className="metric-bar-fill" style={{ width: `${runningRatio}%`, background: 'var(--ok)' }} />
          </div>
          <div className="metric-detail">已停止 {loadState === 'loaded' ? stoppedCount : '—'} · <button type="button" className="metric-filter" aria-pressed={abnormalOnly} onClick={() => setAbnormalOnly(value => !value)}>异常 {loadState === 'loaded' ? abnormalCount : '—'}{abnormalOnly ? ' · 显示全部' : ''}</button></div>
        </div>

        <HostMetricCards metrics={metrics} error={metricsError} />
      </div>
      <div className="metrics-status">
        <span role="status">{metricsError ? `${metricsError}${metrics ? '，数据可能过期' : ''}` : metrics ? `更新于 ${new Date(metrics.sampledAt).toLocaleTimeString()}` : '正在读取监测数据…'}{metrics && !metricsError && metrics.warnings.length > 0 ? ` · ${metrics.warnings.join(' · ')}` : ''}</span>
        <button type="button" className="metric-filter" disabled={metricsBusy} onClick={() => void refreshMetrics()}>{metricsBusy ? '刷新中…' : metricsError ? '重试监测' : '刷新'}</button>
      </div>

      {actionError && <p className="error" role="alert">{actionError}</p>}
      {loadError && (
        <p className="error" role="alert">
          {loadError}
          {loadState === 'loaded' ? ' 当前正在显示上次成功加载的实例数据。' : ''}
        </p>
      )}

      {/* 实例网格与头部操作栏 */}
      <div className="section-header">
        <div className="section-title">
          <span>Minecraft 实例列表</span>
          <span className="tag-badge">{instances.length} 个实例</span>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <Link to="/deploy" className="btn btn-primary">
            <Plus size={15} />
            一键部署
          </Link>
          <Link to="/import" className="btn">
            <FolderDown size={15} />
            导入服务端
          </Link>
          <button type="button" className="btn" onClick={() => setEmptyOpen(true)}>
            <Zap size={15} />
            创建空实例
          </button>
        </div>
      </div>

      {loadState === 'loading' ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
          正在加载实例列表…
        </div>
      ) : loadState === 'error' ? (
        <div className="panel" role="alert" style={{ textAlign: 'center', padding: '32px' }}>
          <p className="muted">实例列表暂时不可用，请检查面板连接后重试。</p>
          <button className="btn btn-ghost" type="button" onClick={retryLoad} style={{ marginTop: '12px' }}>
            重新加载
          </button>
        </div>
      ) : instances.length === 0 ? (
        <div className="panel" style={{ textAlign: 'center', padding: '48px 24px' }}>
          <Layers size={40} style={{ color: 'var(--text-muted)', marginBottom: '12px' }} />
          <h3 style={{ fontSize: '1.1rem', margin: '0 0 8px' }}>暂无 Minecraft 实例</h3>
          <p className="muted" style={{ margin: '0 0 20px' }}>
            您可以从「一键部署」下载官方核心，或从同机目录及 ZIP 包导入已有服务端。
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '12px' }}>
            <Link to="/deploy" className="btn btn-primary">
              <Plus size={15} />
              立即部署第一台服务端
            </Link>
            <Link to="/import" className="btn">
              <FolderDown size={15} />
              导入已有服务端
            </Link>
          </div>
        </div>
      ) : (
        <div className="instance-grid">
          {abnormalOnly && abnormalCount === 0 && <p className="muted">暂无异常实例。</p>}
          {instances.filter(inst => !abnormalOnly || inst.status === 'crashed' || inst.requiresMigration).map((inst) => (
            <div
              key={inst.id}
              className="instance-card"
            >
              <div className="inst-card-top">
                <div className="inst-card-info">
                  <div
                    className="inst-avatar"
                    style={{
                      color: inst.status === 'running' ? 'var(--accent)' : 'var(--text-muted)',
                      borderColor: inst.status === 'running' ? 'var(--accent)' : 'var(--border)',
                    }}
                  >
                    <Server size={22} />
                  </div>
                  <div className="inst-name-group">
                    <Link to={`/instances/${inst.id}`} className="inst-name" title={inst.name}>
                      {inst.name}
                    </Link>
                    <div className="inst-core-badge">
                      {inst.coreType.toUpperCase()} {inst.mcVersion ? `· ${inst.mcVersion}` : ''}
                    </div>
                  </div>
                </div>
                <span className={`status-badge ${inst.requiresMigration ? 'starting' : inst.status}`}>
                  {inst.requiresMigration ? '▲ 待迁移' : `● ${statusLabel[inst.status] || inst.status}`}
                </span>
              </div>

              <div className="inst-stat-row">
                <div className="inst-stat-item">
                  <span className="inst-stat-label" title="按整机逻辑核总容量计算">进程 CPU</span>
                  <span className="inst-stat-val">{processMetric(inst, metrics, metricsError, 'cpu')}</span>
                </div>
                <div className="inst-stat-item">
                  <span className="inst-stat-label" title="实际进程内存占用，与 JVM 堆内存上限不同">进程内存</span>
                  <span className="inst-stat-val">{processMetric(inst, metrics, metricsError, 'memory')}</span>
                </div>
                <div className="inst-stat-item">
                  <span className="inst-stat-label">堆内存上限 (Xmx)</span>
                  <span className="inst-stat-val">{extractXmx(inst.jvmArgs)}</span>
                </div>
                <div className="inst-stat-item">
                  <span className="inst-stat-label">Java 运行时</span>
                  <span className="inst-stat-val">{inst.javaRuntimeId ? '专属环境' : '系统默认'}</span>
                </div>
              </div>

              <div className="inst-card-actions">
                {canStartInstance(inst.status) && (
                  <button
                    className="btn btn-ok"
                    type="button"
                    disabled={busyId === inst.id || inst.requiresMigration}
                    onClick={() => void act(inst.id, 'start')}
                  >
                    <Play size={14} />
                    启动
                  </button>
                )}
                {canStopInstance(inst.status) && (
                  <button
                    className="btn btn-danger"
                    type="button"
                    disabled={busyId === inst.id || inst.requiresMigration}
                    onClick={() => void act(inst.id, 'stop')}
                  >
                    <Power size={14} />
                    停止
                  </button>
                )}
                <Link to={`/instances/${inst.id}`} className="btn btn-primary">
                  进入管理
                </Link>

                <details className="action-menu" style={{ position: 'relative' }}>
                  <summary className="btn btn-icon" title="更多操作">
                    <MoreVertical size={16} />
                  </summary>
                  <div
                    className="btn-row"
                    style={{
                      position: 'absolute',
                      right: 0,
                      bottom: '100%',
                      marginBottom: '6px',
                      background: 'var(--bg-panel)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '6px',
                      boxShadow: 'var(--shadow)',
                      zIndex: 10,
                      flexDirection: 'column',
                      minWidth: '110px',
                    }}
                  >
                    <button
                      className="btn btn-ghost"
                      type="button"
                      style={{ width: '100%', justifyContent: 'flex-start', height: '30px', fontSize: '0.8rem' }}
                      disabled={busyId === inst.id || inst.requiresMigration || isLifecycleBusy(inst.status)}
                      onClick={(event) => {
                        event.currentTarget.closest('details')?.removeAttribute('open');
                        setRestartTarget(inst);
                      }}
                    >
                      <RotateCcw size={13} />
                      重启实例
                    </button>
                    <button
                      className="btn btn-ghost"
                      type="button"
                      style={{ width: '100%', justifyContent: 'flex-start', height: '30px', fontSize: '0.8rem' }}
                      disabled={busyId === inst.id || inst.requiresMigration || !isAlive(inst.status)}
                      onClick={(event) => {
                        event.currentTarget.closest('details')?.removeAttribute('open');
                        setForceStopTarget(inst);
                      }}
                    >
                      <Power size={13} />
                      强制停止
                    </button>
                    <button
                      className="btn btn-danger"
                      type="button"
                      style={{ width: '100%', justifyContent: 'flex-start', height: '30px', fontSize: '0.8rem' }}
                      disabled={busyId === inst.id || (!inst.requiresMigration && isAlive(inst.status))}
                      title={
                        !inst.requiresMigration && isAlive(inst.status)
                          ? '实例仍在运行，请先停止后再删除'
                          : undefined
                      }
                      onClick={(event) => {
                        event.currentTarget.closest('details')?.removeAttribute('open');
                        setDeleteTarget(inst);
                      }}
                    >
                      <Trash2 size={13} />
                      删除实例
                    </button>
                  </div>
                </details>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 创建空实例弹窗 */}
      <ConfirmDialog
        open={emptyOpen}
        title="创建空实例"
        description={
          <>
            <p>将创建受管空目录，创建成功后请在文件页上传 server.jar 并配置启动 Jar。</p>
            <div className="field">
              <label htmlFor="empty-instance-name">实例名称</label>
              <input
                id="empty-instance-name"
                value={emptyName}
                disabled={emptyBusy}
                onChange={(e) => setEmptyName(e.target.value)}
              />
            </div>
            <JavaRuntimeSelect
              value={emptyJavaRuntimeId}
              onChange={setEmptyJavaRuntimeId}
              mcVersion={null}
              disabled={emptyBusy}
              onResolvedMajorChange={setEmptyJavaMajor}
            />
            <JvmSettingsEditor
              value={emptyJvm}
              onChange={setEmptyJvm}
              coreType="custom"
              javaMajor={emptyJavaMajor}
              disabled={emptyBusy}
              useRecommendedDefault
              onValidityChange={setEmptyJvmValid}
            />
            <label htmlFor="empty-instance-eula" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input
                id="empty-instance-eula"
                type="checkbox"
                checked={emptyEula}
                disabled={emptyBusy}
                onChange={(e) => setEmptyEula(e.target.checked)}
              />
              自动接受 Mojang EULA（eula=true）
            </label>
          </>
        }
        confirmLabel="创建并前往文件页"
        busy={emptyBusy}
        confirmDisabled={!emptyJvmValid}
        onConfirm={() => void confirmCreateEmpty()}
        onCancel={() => setEmptyOpen(false)}
      />

      {/* 重启确认 */}
      <ConfirmDialog
        open={restartTarget !== null}
        title={`重启实例「${restartTarget?.name ?? ''}」？`}
        description="重启会中断当前游戏进程并断开所有在线玩家，未保存的世界数据可能丢失。"
        confirmLabel="确认重启"
        busy={busyId === restartTarget?.id}
        onConfirm={() => void confirmRestart()}
        onCancel={() => setRestartTarget(null)}
      />

      {/* 强制停止确认 */}
      <ConfirmDialog
        open={forceStopTarget !== null}
        title={`强制停止实例「${forceStopTarget?.name ?? ''}」？`}
        description="强制停止会立即向进程发送 SIGKILL，可能导致世界损坏。建议先尝试普通「停止」。"
        confirmLabel="确认强制停止"
        danger
        busy={busyId === forceStopTarget?.id}
        onConfirm={() => void confirmForceStop()}
        onCancel={() => setForceStopTarget(null)}
      />

      {/* 删除确认 */}
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
