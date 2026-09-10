import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, FolderDown, FolderUp, RefreshCw } from 'lucide-react';
import type { CoreType, ExistingServerSourceInfo, ImportPreviewInfo, TaskInfo } from '@mmd/shared';
import {
  ApiError,
  api,
  cancelImportPreview,
  confirmImportPreview,
  createImportPreview,
  getImportPreview,
  listExistingServerSources,
  pollTask,
} from '../api';
import { JavaRuntimeSelect } from '../components/JavaRuntimeSelect';
import { JvmSettingsEditor, type DetectedJvmChoice } from '../components/JvmSettingsEditor';

type ImportMode = 'directory' | 'zip';

const IMPORT_PREVIEW_SESSION_KEY = 'mmd_import_preview_id';

const coreTypeOptions: Array<{ value: CoreType; label: string }> = [
  { value: 'custom', label: '自动识别 / 自定义' },
  { value: 'paper', label: 'Paper' },
  { value: 'fabric', label: 'Fabric' },
  { value: 'forge', label: 'Forge' },
  { value: 'neoforge', label: 'NeoForge' },
  { value: 'vanilla', label: 'Vanilla' },
];

function clearStoredPreview() {
  sessionStorage.removeItem(IMPORT_PREVIEW_SESSION_KEY);
}

export function ImportPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<ImportMode>('directory');
  const [name, setName] = useState('已有服务器');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewInfo | null>(null);
  const [restoringPreview, setRestoringPreview] = useState(true);
  const [sources, setSources] = useState<ExistingServerSourceInfo[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [sourcesError, setSourcesError] = useState('');
  const [coreType, setCoreType] = useState<CoreType>('custom');
  const [mcVersion, setMcVersion] = useState('');
  const [jvmArgs, setJvmArgs] = useState('-Xms1G -Xmx2G');
  const [javaRuntimeId, setJavaRuntimeId] = useState<string | null>(null);
  const [javaMajor, setJavaMajor] = useState<number | null>(null);
  const [detectedChoice, setDetectedChoice] = useState<DetectedJvmChoice>(null);
  const [jvmValid, setJvmValid] = useState(true);
  const [acceptEula, setAcceptEula] = useState(true);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<TaskInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  /** 组件卸载时中止进行中的请求和任务轮询，避免离开页面后继续更新状态。 */
  const pollAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => pollAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    const previewId = sessionStorage.getItem(IMPORT_PREVIEW_SESSION_KEY);
    if (!previewId) {
      setRestoringPreview(false);
      return;
    }
    const controller = new AbortController();
    void getImportPreview(previewId, controller.signal)
      .then((restored) => {
        setPreview(restored);
        setMode('zip');
      })
      .catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        clearStoredPreview();
        if (!(err instanceof ApiError && [404, 410].includes(err.status))) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => setRestoringPreview(false));
    return () => controller.abort();
  }, []);

  const loadSources = useCallback(async () => {
    setSourcesLoading(true);
    try {
      const next = await listExistingServerSources();
      setSources(next);
      setSourceId((current) => {
        if (next.some((source) => source.id === current && source.ready)) return current;
        return next.find((source) => source.ready)?.id ?? '';
      });
      setSourcesError('');
    } catch (err) {
      setSourcesError(err instanceof Error ? err.message : String(err));
    } finally {
      setSourcesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  const selectedSource = useMemo(
    () => sources.find((source) => source.id === sourceId) ?? null,
    [sourceId, sources],
  );
  const detectedJvmConfig = mode === 'directory'
    ? selectedSource?.detectedJvmConfig
    : preview?.detectedJvmConfig;
  const progressValue = progress
    ? Math.min(100, Math.max(0, Number.isFinite(progress.progress) ? progress.progress : 0))
    : 0;
  function selectZip(selected: File | null) {
    if (busy || restoringPreview || !selected) return;
    if (!selected.name.toLowerCase().endsWith('.zip')) {
      setError('请选择 ZIP 格式的服务端压缩包。');
      return;
    }
    setError('');
    setFile(selected);
  }

  const configurationVisible = mode === 'directory' || preview !== null;
  const canSubmit = !busy
    && !restoringPreview
    && (mode === 'directory'
      ? Boolean(selectedSource?.ready && jvmValid)
      : file !== null || Boolean(preview && jvmValid));

  useEffect(() => {
    if (selectedSource?.ready) setCoreType(selectedSource.coreType);
  }, [selectedSource?.id, selectedSource?.ready, selectedSource?.coreType]);

  useEffect(() => {
    setDetectedChoice(null);
  }, [mode, preview?.id, selectedSource?.id]);

  async function cancelPreview() {
    if (!preview) return;
    setBusy(true);
    setError('');
    try {
      await cancelImportPreview(preview.id);
      clearStoredPreview();
      setPreview(null);
      setFile(null);
      setDetectedChoice(null);
    } catch (err) {
      if (err instanceof ApiError && [404, 410].includes(err.status)) {
        clearStoredPreview();
        setPreview(null);
        setFile(null);
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === 'directory' && !selectedSource?.ready) {
      setError('请选择一个可用的交接目录');
      return;
    }
    if (mode === 'zip' && !file && !preview) {
      setError('请选择 ZIP 安装包并先完成预检');
      return;
    }
    const isPreviewUpload = mode === 'zip' && file !== null;
    if (!isPreviewUpload && !jvmValid) {
      setError('请先修正 JVM 参数错误并完成检测参数选择');
      return;
    }

    setBusy(true);
    setError('');
    if (!isPreviewUpload) setProgress(null);
    const controller = new AbortController();
    pollAbortRef.current = controller;
    try {
      if (isPreviewUpload) {
        const created = await createImportPreview(file, controller.signal);
        if (controller.signal.aborted) return;
        setPreview(created);
        setFile(null);
        setDetectedChoice(null);
        sessionStorage.setItem(IMPORT_PREVIEW_SESSION_KEY, created.id);
        return;
      }

      let task: TaskInfo;
      if (mode === 'directory') {
        task = await api<TaskInfo>('/api/import/existing', {
          method: 'POST',
          signal: controller.signal,
          json: {
            name,
            sourceId,
            coreType,
            mcVersion: mcVersion || undefined,
            jvmArgs,
            acceptEula,
            javaRuntimeId,
          },
        });
      } else {
        task = await confirmImportPreview(preview!.id, {
          name,
          coreType,
          mcVersion: mcVersion || undefined,
          jvmArgs,
          acceptEula,
          javaRuntimeId,
        }, controller.signal);
        clearStoredPreview();
        setPreview(null);
      }

      if (controller.signal.aborted) return;
      setProgress(task);
      const result = await pollTask(task.id, (next) => setProgress(next as TaskInfo), controller.signal);
      if (result.instanceId) navigate(`/instances/${result.instanceId}`);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      if (mode === 'zip' && err instanceof ApiError && [404, 410].includes(err.status)) {
        clearStoredPreview();
        setPreview(null);
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (pollAbortRef.current === controller) pollAbortRef.current = null;
      setBusy(false);
    }
  }

  const submitLabel = busy
    ? mode === 'zip' && file ? '上传预检中…' : '导入中…'
    : mode === 'directory'
      ? '复制并接管'
      : file
        ? preview ? '上传并替换预览' : '上传并预检'
        : preview ? '确认配置并导入' : '请选择 ZIP';

  return (
    <div className="import-workspace">
      <div className="section-header">
        <div>
          <h1 className="page-title" style={{ margin: 0 }}>导入已有 Minecraft 服务端</h1>
          <p className="page-desc" style={{ margin: '4px 0 0' }}>
            支持 ZIP 服务端安装包解压预检，或同机目录只读交接，原目录不会被破坏或删除。
          </p>
        </div>
      </div>

      <div className="import-mode-switch" role="group" aria-label="导入方式">
        <button
          type="button"
          className={mode === 'directory' ? 'active' : undefined}
          aria-pressed={mode === 'directory'}
          disabled={busy}
          onClick={() => setMode('directory')}
        >
          同机目录直接交接
        </button>
        <button
          type="button"
          className={mode === 'zip' ? 'active' : undefined}
          aria-pressed={mode === 'zip'}
          disabled={busy}
          onClick={() => setMode('zip')}
        >
          ZIP 服务端整合包导入
        </button>
      </div>

      <form className="form-card import-panel" onSubmit={(e) => void onSubmit(e)}>
        <div className="import-panel-body" role="region" aria-label="导入配置" tabIndex={0}>
        {mode === 'directory' ? (
          <>
            <div className="managed-note import-handoff-note">
              <strong>安全交接步骤</strong>
              <ol>
                <li>先正常停止原服务器，确保世界数据已保存。</li>
                <li>把完整服务端目录复制到 <code>DATA_DIR/imports/&lt;目录名&gt;</code>。</li>
                <li>在下方刷新并选择目录；面板会再次复制到新的托管实例。</li>
              </ol>
              <span>交接区只列出直接子目录，不支持输入或浏览任意系统路径。</span>
            </div>
            <div className="field">
              <label htmlFor="existing-server-source">选择检测到的交接目录</label>
              <div className="btn-row import-source-row">
                <select
                  id="existing-server-source"
                  value={sourceId}
                  disabled={busy || sourcesLoading}
                  onChange={(e) => setSourceId(e.target.value)}
                >
                  <option value="">{sourcesLoading ? '正在读取…' : '请选择交接目录'}</option>
                  {sources.map((source) => (
                    <option key={source.id} value={source.id} disabled={!source.ready}>
                      {source.ready
                        ? `${source.id} · ${source.launchTarget ?? '待完整校验'}`
                        : `${source.id} · 不可用：${source.error}`}
                    </option>
                  ))}
                </select>
                <button
                  className="btn"
                  type="button"
                  disabled={busy || sourcesLoading}
                  onClick={() => void loadSources()}
                >
                  <RefreshCw size={14} />
                  {sourcesLoading ? '读取中…' : '刷新目录'}
                </button>
              </div>
              {!sourcesLoading && sources.length === 0 ? (
                <p className="muted field-help">交接区暂无目录，请完成上面的复制步骤后刷新。</p>
              ) : null}
              {selectedSource?.ready && selectedSource.launchTarget ? (
                <p className="muted field-help">
                  已探测启动目标：<code>{selectedSource.launchTarget}</code>
                </p>
              ) : null}
              {selectedSource?.ready && selectedSource.error ? (
                <p className="muted field-help">{selectedSource.error}</p>
              ) : null}
              {sourcesError ? <p className="error">无法读取交接目录：{sourcesError}</p> : null}
            </div>
          </>
        ) : (
          <>
            <div className="managed-note">
              <strong>ZIP 二阶段安全导入</strong>
              <span>先上传并执行目录探测与 JVM 识别预检，再确认实例配置并入队复制，安全可靠。</span>
            </div>
            {restoringPreview ? <p className="muted" role="status">正在恢复待确认的 ZIP…</p> : null}
            {preview ? (
              <div className="import-preview-card" aria-live="polite">
                <div>
                  <strong>预检已完成</strong>
                  <span>{preview.fileName} · {(preview.sizeBytes / 1024 / 1024).toFixed(1)} MiB</span>
                  <span>有效至 {new Date(preview.expiresAt).toLocaleString()}</span>
                </div>
                <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => void cancelPreview()}>
                  取消并重新选择
                </button>
              </div>
            ) : null}

            <div className="field">
              <label htmlFor="existing-server-zip">服务端压缩包 (.zip)</label>
              <div
                style={{
                  border: `2px dashed ${isDragging ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 'var(--radius)',
                  padding: '36px 20px',
                  textAlign: 'center',
                  cursor: busy || restoringPreview ? 'not-allowed' : 'pointer',
                  background: isDragging ? 'var(--accent-subtle)' : file ? 'var(--bg-elevated)' : 'var(--bg)',
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '10px',
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!busy && !restoringPreview) setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  if (busy || restoringPreview) return;
                  const dropped = e.dataTransfer.files?.[0];
                  selectZip(dropped ?? null);
                }}
              >
                <FolderUp size={40} style={{ color: 'var(--accent)' }} />
                <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                  {file ? file.name : '选择或拖拽 ZIP 压缩包至此处'}
                </div>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {file
                    ? `文件大小: ${(file.size / 1024 / 1024).toFixed(1)} MB`
                    : '上传大小与解压限制由面板配置决定'}
                </span>
                <button className="btn" type="button" disabled={busy || restoringPreview}
                  onClick={() => document.getElementById('existing-server-zip')?.click()}>
                  选择 ZIP
                </button>
              </div>
              <input
                key={preview?.id ?? 'new-preview'}
                id="existing-server-zip"
                type="file"
                accept=".zip,application/zip"
                disabled={busy || restoringPreview}
                style={{ display: 'none' }}
                onChange={(e) => { selectZip(e.target.files?.[0] ?? null); e.target.value = ''; }}
              />
              {preview ? (
                <p className="muted field-help">选择新文件并提交会先创建新预览，成功后才替换当前 ZIP。</p>
              ) : null}
            </div>
          </>
        )}

        {configurationVisible ? (
          <>
            <div className="field">
              <label htmlFor="import-instance-name">实例名称</label>
              <input
                id="import-instance-name"
                value={name}
                disabled={busy}
                maxLength={128}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="grid grid-2 import-meta-grid">
              <div className="field">
                <label htmlFor="import-core-type">核心类型</label>
                <select
                  id="import-core-type"
                  value={coreType}
                  disabled={busy}
                  onChange={(e) => setCoreType(e.target.value as CoreType)}
                >
                  {coreTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="import-mc-version">Minecraft 版本（可选）</label>
                <input
                  id="import-mc-version"
                  value={mcVersion}
                  disabled={busy}
                  maxLength={64}
                  placeholder="例如 1.20.1"
                  onChange={(e) => setMcVersion(e.target.value)}
                />
              </div>
            </div>

            <JavaRuntimeSelect
              value={javaRuntimeId}
              onChange={setJavaRuntimeId}
              onResolvedMajorChange={setJavaMajor}
              mcVersion={mcVersion}
              disabled={busy}
            />
            <JvmSettingsEditor
              value={jvmArgs}
              onChange={setJvmArgs}
              coreType={coreType}
              javaMajor={javaMajor}
              disabled={busy}
              useRecommendedDefault
              detectedJvmConfig={detectedJvmConfig}
              detectedChoice={detectedChoice}
              onDetectedChoiceChange={setDetectedChoice}
              onValidityChange={setJvmValid}
            />
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={acceptEula}
                disabled={busy}
                onChange={(e) => setAcceptEula(e.target.checked)}
              />
              启动时自动写入 eula=true（请先确认接受 Mojang EULA）
            </label>
          </>
        ) : null}

        {error ? <p className="error">{error}</p> : null}
        {progress ? (
          <div className="import-progress" aria-live="polite">
            <div className="muted">
              {progress.message}（{Math.round(progressValue)}%）
            </div>
            <div
              className="progress"
              role="progressbar"
              aria-label="导入进度"
              aria-valuenow={progressValue}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span style={{ width: `${progressValue}%` }} />
            </div>
          </div>
        ) : null}
        {busy ? (
          <p className="muted" role="status" aria-live="polite">
            {mode === 'zip' && file ? '正在上传并检查 ZIP，请保持此页打开。' : '导入已进入后台，可离开此页并在任务中心查看。'}
          </p>
        ) : null}

        </div>
        <div className="import-panel-footer">
          <button className="btn btn-primary" type="submit" disabled={!canSubmit} style={{ padding: '0 24px' }}>
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
