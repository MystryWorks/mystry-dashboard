import { useCallback, useEffect, useMemo, useRef, useState, useId } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TaskInfo } from '@mystry/shared';
import { api, pollTask } from '../api';
import { LazyScrollSelect } from '../components/LazyScrollSelect';
import { JavaRuntimeSelect } from '../components/JavaRuntimeSelect';
import { JvmSettingsEditor } from '../components/JvmSettingsEditor';
import '../deploy-error.css';

type CoreType = 'paper' | 'fabric' | 'vanilla' | 'forge' | 'neoforge';

const CORE_ITEMS: Array<{ id: CoreType; name: string; desc: string; icon: string }> = [
  { id: 'paper', name: 'Paper', desc: '高性能插件服', icon: '📜' },
  { id: 'fabric', name: 'Fabric', desc: '轻量现代化模组', icon: '🧵' },
  { id: 'forge', name: 'Forge', desc: '经典重型模组', icon: '🔨' },
  { id: 'neoforge', name: 'NeoForge', desc: '新一代模组端', icon: '⚡' },
  { id: 'vanilla', name: 'Vanilla', desc: 'Mojang 原版', icon: '🧊' },
];

// 页面只保留紧凑摘要，完整错误交给受限尺寸的详情弹窗展示。
const ERROR_PREVIEW_MAX_LENGTH = 240;

function createErrorPreview(message: string): string {
  const normalized = message.replace(/\s+/g, ' ').trim();
  if (normalized.length <= ERROR_PREVIEW_MAX_LENGTH) return normalized;
  return `${normalized.slice(0, ERROR_PREVIEW_MAX_LENGTH - 1)}…`;
}

export function DeployPage() {
  const navigate = useNavigate();
  const [coreType, setCoreType] = useState<CoreType | ''>('');
  const [versions, setVersions] = useState<string[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsLoadedFor, setVersionsLoadedFor] = useState<CoreType | ''>('');
  const [mcVersion, setMcVersion] = useState('');
  const [builds, setBuilds] = useState<number[]>([]);
  const [buildsLoading, setBuildsLoading] = useState(false);
  const [buildsLoadedFor, setBuildsLoadedFor] = useState('');
  const [build, setBuild] = useState<number | ''>('');
  const [loaders, setLoaders] = useState<string[]>([]);
  const [loadersLoading, setLoadersLoading] = useState(false);
  const [loadersLoadedFor, setLoadersLoadedFor] = useState('');
  const [loaderVersion, setLoaderVersion] = useState('');
  const [installers, setInstallers] = useState<string[]>([]);
  const [installersLoading, setInstallersLoading] = useState(false);
  const [installersLoadedFor, setInstallersLoadedFor] = useState('');
  const [installerVersion, setInstallerVersion] = useState('');
  const [name, setName] = useState('我的服务器');
  const [jvmArgs, setJvmArgs] = useState('-Xms1G -Xmx2G');
  const [javaRuntimeId, setJavaRuntimeId] = useState<string | null>(null);
  const [javaMajor, setJavaMajor] = useState<number | null>(null);
  const [jvmValid, setJvmValid] = useState(true);
  const [acceptEula, setAcceptEula] = useState(true);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<TaskInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const errorDialogRef = useRef<HTMLDialogElement>(null);
  const metadataGenerationRef = useRef(0);
  /** 组件卸载时中止进行中的任务轮询，避免登出/离开页面后仍持续请求或跳转。 */
  const pollAbortRef = useRef<AbortController | null>(null);
  const nameFieldId = useId();
  const coreTypeFieldId = useId();
  const eulaFieldId = useId();
  const errorPreview = useMemo(() => createErrorPreview(error), [error]);
  const hasErrorDetails = error.includes('\n') || error.length > ERROR_PREVIEW_MAX_LENGTH;

  useEffect(() => {
    return () => pollAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    const dialog = errorDialogRef.current;
    if (!dialog) return;
    if (showErrorDetails && !dialog.open) dialog.showModal();
    else if (!showErrorDetails && dialog.open) dialog.close();
  }, [showErrorDetails]);

  useEffect(() => {
    if (error) return;
    setShowErrorDetails(false);
    setCopyStatus('idle');
  }, [error]);

  useEffect(() => {
    if (copyStatus === 'idle') return;
    const timer = window.setTimeout(() => setCopyStatus('idle'), 2_000);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);

  async function copyError(): Promise<void> {
    try {
      await navigator.clipboard.writeText(error);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }
  }

  function resetDependentFields() {
    setVersions([]);
    setVersionsLoadedFor('');
    setMcVersion('');
    setBuilds([]);
    setBuildsLoadedFor('');
    setBuild('');
    setLoaders([]);
    setLoadersLoadedFor('');
    setLoaderVersion('');
    setInstallers([]);
    setInstallersLoadedFor('');
    setInstallerVersion('');
  }

  function handleCoreTypeChange(next: CoreType | '') {
    metadataGenerationRef.current += 1;
    setCoreType(next);
    setError('');
    resetDependentFields();
  }

  function handleMcVersionChange(next: string) {
    metadataGenerationRef.current += 1;
    setMcVersion(next);
    setBuilds([]);
    setBuildsLoadedFor('');
    setBuild('');
    setLoaders([]);
    setLoadersLoadedFor('');
    setLoaderVersion('');
    setInstallers([]);
    setInstallersLoadedFor('');
    setInstallerVersion('');
  }

  const loadVersions = useCallback(async () => {
    if (!coreType) return;
    if (versionsLoadedFor === coreType) return;
    const generation = metadataGenerationRef.current;
    setVersionsLoading(true);
    setError('');
    try {
      const res = await api<{ versions: string[] }>(`/api/cores/${coreType}/versions`);
      if (generation !== metadataGenerationRef.current) return;
      setVersions(res.versions);
      setVersionsLoadedFor(coreType);
    } catch (err) {
      if (generation !== metadataGenerationRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (generation === metadataGenerationRef.current) setVersionsLoading(false);
    }
  }, [coreType, versionsLoadedFor]);

  const loadBuilds = useCallback(async () => {
    if (coreType !== 'paper' || !mcVersion) return;
    const key = `${coreType}:${mcVersion}`;
    if (buildsLoadedFor === key) return;
    const generation = metadataGenerationRef.current;
    setBuildsLoading(true);
    setError('');
    try {
      const res = await api<{ builds: number[] }>(`/api/cores/paper/${mcVersion}/builds`);
      if (generation !== metadataGenerationRef.current) return;
      setBuilds(res.builds);
      setBuildsLoadedFor(key);
    } catch (err) {
      if (generation !== metadataGenerationRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (generation === metadataGenerationRef.current) setBuildsLoading(false);
    }
  }, [coreType, mcVersion, buildsLoadedFor]);

  const loadLoaders = useCallback(async () => {
    if (!coreType || !mcVersion) return;
    if (coreType !== 'fabric' && coreType !== 'forge' && coreType !== 'neoforge') return;
    const key = `${coreType}:${mcVersion}`;
    if (loadersLoadedFor === key) return;
    const generation = metadataGenerationRef.current;
    setLoadersLoading(true);
    setError('');
    try {
      if (coreType === 'fabric') {
        const res = await api<{ loaders: string[]; installers: string[] }>(
          `/api/cores/fabric/${mcVersion}/loaders`,
        );
        if (generation !== metadataGenerationRef.current) return;
        setLoaders(res.loaders);
        setInstallers(res.installers);
        setLoadersLoadedFor(key);
        setInstallersLoadedFor(key);
      } else {
        const res = await api<{ loaders: string[] }>(`/api/cores/${coreType}/${mcVersion}/loaders`);
        if (generation !== metadataGenerationRef.current) return;
        setLoaders(res.loaders);
        setLoadersLoadedFor(key);
      }
    } catch (err) {
      if (generation !== metadataGenerationRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (generation === metadataGenerationRef.current) setLoadersLoading(false);
    }
  }, [coreType, mcVersion, loadersLoadedFor]);

  const loadInstallers = useCallback(async () => {
    if (coreType !== 'fabric' || !mcVersion) return;
    const key = `${coreType}:${mcVersion}`;
    if (installersLoadedFor === key) return;
    // Fabric 的 installer 与 loader 同源接口，复用 loadLoaders
    await loadLoaders();
  }, [coreType, mcVersion, installersLoadedFor, loadLoaders]);

  async function deploy() {
    if (!coreType || !mcVersion) return;
    if (!jvmValid) {
      setError('请先修正 JVM 参数错误');
      return;
    }
    setBusy(true);
    setError('');
    setProgress(null);
    // 先建控制器并保存：POST 期间卸载也能立即中止，避免之后无人接管轮询。
    const controller = new AbortController();
    pollAbortRef.current = controller;
    try {
      const task = await api<TaskInfo>('/api/cores/deploy', {
        method: 'POST',
        signal: controller.signal,
        json: {
          name,
          coreType,
          mcVersion,
          build: build === '' ? undefined : Number(build),
          loaderVersion: loaderVersion || undefined,
          installerVersion: installerVersion || undefined,
          jvmArgs,
          acceptEula,
          javaRuntimeId,
        },
      });
      if (controller.signal.aborted) return;
      setProgress(task);
      const result = await pollTask(task.id, (t) => setProgress(t as TaskInfo), controller.signal);
      if (result.instanceId) navigate(`/instances/${result.instanceId}`);
    } catch (err) {
      // 组件卸载导致的中止不是错误，不需要提示。
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const loaderLabel =
    coreType === 'forge' ? 'Forge 版本' : coreType === 'neoforge' ? 'NeoForge 版本' : 'Loader 版本';

  const canDeploy =
    Boolean(coreType && mcVersion) &&
    (coreType !== 'paper' || build !== '') &&
    (coreType !== 'fabric' || (Boolean(loaderVersion) && Boolean(installerVersion))) &&
    ((coreType !== 'forge' && coreType !== 'neoforge') || Boolean(loaderVersion));
  const progressValue = progress
    ? Math.min(100, Math.max(0, Number.isFinite(progress.progress) ? progress.progress : 0))
    : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="section-header">
        <div>
          <h1 className="page-title" style={{ margin: 0 }}>一键部署全新 Minecraft 服务端</h1>
          <p className="page-desc" style={{ margin: '4px 0 0' }}>
            官方镜像流式拉取 · 自动生成启动脚本与 EULA 配置
          </p>
        </div>
      </div>

      <div className="deploy-grid">
        <div className="form-card">
          <div className="form-group">
            <label className="form-label">1. 选择服务端核心类型</label>
            <div className="core-select-grid">
              {CORE_ITEMS.map((item) => (
                <div
                  key={item.id}
                  className={`core-option${coreType === item.id ? ' selected' : ''}`}
                  onClick={() => !busy && handleCoreTypeChange(item.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !busy) handleCoreTypeChange(item.id);
                  }}
                >
                  <div className="core-icon">{item.icon}</div>
                  <span className="core-name">{item.name}</span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{item.desc}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="field">
            <label htmlFor={nameFieldId}>2. 实例名称</label>
            <input
              id={nameFieldId}
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="field">
            <label id={`${nameFieldId}-mc-version-label`}>3. 游戏版本</label>
            <LazyScrollSelect
              ariaLabel="游戏版本"
              value={mcVersion}
              options={versions}
              onChange={handleMcVersionChange}
              onOpen={() => void loadVersions()}
              loading={versionsLoading}
              disabled={busy || !coreType}
              placeholder="请先选定上方核心后选择版本"
              emptyText="暂无可用版本"
            />
          </div>
          {coreType === 'paper' && (
            <div className="field">
              <label id={`${nameFieldId}-paper-build-label`}>4. Paper 构建版本 (Build)</label>
              <LazyScrollSelect
                ariaLabel="Paper Build"
                value={build}
                options={builds}
                onChange={setBuild}
                onOpen={() => void loadBuilds()}
                loading={buildsLoading}
                formatLabel={(b) => `#${b}`}
                disabled={busy || !mcVersion}
                placeholder="请选择构建"
                emptyText="暂无 Build"
              />
            </div>
          )}
          {(coreType === 'fabric' || coreType === 'forge' || coreType === 'neoforge') && (
            <div className="field">
              <label id={`${nameFieldId}-loader-label`}>{loaderLabel}</label>
              <LazyScrollSelect
                ariaLabel={loaderLabel}
                value={loaderVersion}
                options={loaders}
                onChange={setLoaderVersion}
                onOpen={() => void loadLoaders()}
                loading={loadersLoading}
                disabled={busy || !mcVersion}
                placeholder="请选择"
                emptyText="暂无版本"
              />
            </div>
          )}
          {coreType === 'fabric' && (
            <div className="field">
              <label id={`${nameFieldId}-installer-label`}>Installer 版本</label>
              <LazyScrollSelect
                ariaLabel="Fabric Installer 版本"
                value={installerVersion}
                options={installers}
                onChange={setInstallerVersion}
                onOpen={() => void loadInstallers()}
                loading={installersLoading || loadersLoading}
                disabled={busy || !mcVersion}
                placeholder="请选择"
                emptyText="暂无版本"
              />
            </div>
          )}
          {(coreType === 'forge' || coreType === 'neoforge') && (
            <p className="muted" style={{ fontSize: '0.85rem' }}>
              Forge/NeoForge 会下载官方 Installer 并在安装目录执行 --installServer，耗时可能较长。
            </p>
          )}
          <JavaRuntimeSelect
            value={javaRuntimeId}
            onChange={setJavaRuntimeId}
            mcVersion={mcVersion || null}
            disabled={busy}
            onResolvedMajorChange={setJavaMajor}
          />
          <JvmSettingsEditor
            value={jvmArgs}
            onChange={setJvmArgs}
            coreType={coreType || 'custom'}
            javaMajor={javaMajor}
            disabled={busy}
            useRecommendedDefault
            onValidityChange={setJvmValid}
          />
          <label
            htmlFor={eulaFieldId}
            style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '4px' }}
          >
            <input
              id={eulaFieldId}
              type="checkbox"
              checked={acceptEula}
              disabled={busy}
              onChange={(e) => setAcceptEula(e.target.checked)}
            />
            我已阅读并同意 <a href="https://account.mojang.com/documents/minecraft_eula" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>Minecraft 最终用户许可协议 (EULA)</a>
          </label>

          {progress && (
            <div style={{ marginTop: '10px' }} aria-live="polite">
              <div className="muted" style={{ fontSize: '0.85rem', marginBottom: '4px' }}>
                {progress.message}（{Math.round(progressValue)}%）
              </div>
              <div
                className="metric-bar"
                role="progressbar"
                aria-label="部署进度"
                aria-valuenow={progressValue}
                aria-valuemin={0}
                aria-valuemax={100}
                style={{ height: 6 }}
              >
                <div className="metric-bar-fill" style={{ width: `${progressValue}%` }} />
              </div>
            </div>
          )}
          {busy && (
            <p className="muted" role="status" aria-live="polite" style={{ fontSize: '0.84rem' }}>
              部署任务已进入后台队列，可随时离开此页，任务会在右上角「任务队列」中持续更新。
            </p>
          )}
          {error && (
            <section className="error-summary" role="alert" aria-labelledby="deploy-error-title">
              <div className="error-summary-content">
                <strong id="deploy-error-title">部署失败</strong>
                <p>{errorPreview}</p>
              </div>
              <div className="error-summary-actions">
                <button className="btn btn-ghost" type="button" onClick={() => void copyError()}>
                  {copyStatus === 'copied'
                    ? '已复制'
                    : copyStatus === 'failed'
                      ? '复制失败'
                      : '复制错误'}
                </button>
                {hasErrorDetails && (
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => setShowErrorDetails(true)}
                  >
                    查看详情
                  </button>
                )}
              </div>
            </section>
          )}

          {error && (
            <dialog
              ref={errorDialogRef}
              className="error-dialog"
              aria-labelledby="error-dialog-title"
              onClose={() => setShowErrorDetails(false)}
              onCancel={(event) => {
                event.preventDefault();
                setShowErrorDetails(false);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                setShowErrorDetails(false);
              }}
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) setShowErrorDetails(false);
              }}
            >
              <div className="error-dialog-panel">
                <header className="error-dialog-header">
                  <div>
                    <h2 id="error-dialog-title">部署错误详情</h2>
                    <p>完整错误内容，可复制后用于排查。</p>
                  </div>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    aria-label="关闭错误详情"
                    onClick={() => setShowErrorDetails(false)}
                  >
                    关闭
                  </button>
                </header>
                <pre className="error-dialog-output">{error}</pre>
                <footer className="error-dialog-footer">
                  <span className="muted" aria-live="polite">
                    {copyStatus === 'copied'
                      ? '错误内容已复制到剪贴板'
                      : copyStatus === 'failed'
                        ? '复制失败，请在内容区域中手动选择复制'
                        : ''}
                  </span>
                  <button className="btn" type="button" onClick={() => void copyError()}>
                    {copyStatus === 'copied' ? '已复制' : '复制全部'}
                  </button>
                </footer>
              </div>
            </dialog>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '14px' }}>
            <button
              className="btn btn-primary"
              type="button"
              disabled={busy || !canDeploy || !jvmValid}
              onClick={() => void deploy()}
              style={{ padding: '0 24px' }}
            >
              {busy ? '部署任务运行中…' : '立即开始自动化部署'}
            </button>
          </div>
        </div>

        {/* 右侧指导与说明卡片 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div className="form-card">
            <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>部署安全与隔离机制</h3>
            <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
              面板采用二阶段原子暂存架构：下载与构建先写入 <code style={{ color: 'var(--accent)' }}>.mystry-staging/</code> 临时沙箱。
              只有在服务端核心校验和安装成功后，才会原子移动至正式实例目录，保障数据安全无损。
            </p>
            <div style={{ padding: '12px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.8rem', color: 'var(--ok)', lineHeight: 1.6 }}>
              ✔ 环境变量脱敏保护（不向 Java 传递面板密钥）<br />
              ✔ 进程安全关服宽限期保护<br />
              ✔ 后台流式下载，可随时关闭页面
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
