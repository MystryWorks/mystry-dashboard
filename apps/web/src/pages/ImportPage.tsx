import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
    <div>
      <h1 className="page-title">导入已有服务端</h1>
      <p className="page-desc">把面板外部署的服务器复制为托管实例，原目录不会被移动或删除。</p>

      <div className="import-mode-switch" role="group" aria-label="导入方式">
        <button
          type="button"
          className={mode === 'directory' ? 'active' : undefined}
          aria-pressed={mode === 'directory'}
          disabled={busy}
          onClick={() => setMode('directory')}
        >
          同机目录交接
        </button>
        <button
          type="button"
          className={mode === 'zip' ? 'active' : undefined}
          aria-pressed={mode === 'zip'}
          disabled={busy}
          onClick={() => setMode('zip')}
        >
          上传 ZIP
        </button>
      </div>

      <form className="panel import-panel" onSubmit={(e) => void onSubmit(e)}>
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
              <label htmlFor="existing-server-source">交接目录</label>
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
                  className="btn btn-ghost"
                  type="button"
                  disabled={busy || sourcesLoading}
                  onClick={() => void loadSources()}
                >
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
              <strong>ZIP 分两步导入</strong>
              <span>先上传预检 JVM 配置，再确认实例设置并进入后台导入；不会覆盖已有实例。</span>
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
                  取消并删除 ZIP
                </button>
              </div>
            ) : null}
            <div className="field">
              <label htmlFor="existing-server-zip">安装包（.zip）</label>
              <input
                key={preview?.id ?? 'new-preview'}
                id="existing-server-zip"
                type="file"
                accept=".zip,application/zip"
                disabled={busy || restoringPreview}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                required={!preview}
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

        <button className="btn" type="submit" disabled={!canSubmit}>
          {submitLabel}
        </button>
      </form>
    </div>
  );
}
