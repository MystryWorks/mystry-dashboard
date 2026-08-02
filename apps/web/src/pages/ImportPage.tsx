import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CoreType, ExistingServerSourceInfo, TaskInfo } from '@mmd/shared';
import { api, apiForm, listExistingServerSources, pollTask } from '../api';
import { JavaRuntimeSelect } from '../components/JavaRuntimeSelect';
import { JavaEnvironmentStatus } from '../components/PathFields';

type ImportMode = 'directory' | 'zip';

const coreTypeOptions: Array<{ value: CoreType; label: string }> = [
  { value: 'custom', label: '自动识别 / 自定义' },
  { value: 'paper', label: 'Paper' },
  { value: 'fabric', label: 'Fabric' },
  { value: 'forge', label: 'Forge' },
  { value: 'neoforge', label: 'NeoForge' },
  { value: 'vanilla', label: 'Vanilla' },
];

export function ImportPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<ImportMode>('directory');
  const [name, setName] = useState('已有服务器');
  const [file, setFile] = useState<File | null>(null);
  const [sources, setSources] = useState<ExistingServerSourceInfo[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [sourcesError, setSourcesError] = useState('');
  const [coreType, setCoreType] = useState<CoreType>('custom');
  const [mcVersion, setMcVersion] = useState('');
  const [jvmArgs, setJvmArgs] = useState('-Xms1G -Xmx2G');
  const [javaRuntimeId, setJavaRuntimeId] = useState<string | null>(null);
  const [acceptEula, setAcceptEula] = useState(true);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<TaskInfo | null>(null);
  const [busy, setBusy] = useState(false);

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

  useEffect(() => {
    if (selectedSource?.ready) setCoreType(selectedSource.coreType);
  }, [selectedSource?.id, selectedSource?.ready, selectedSource?.coreType]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === 'directory' && !selectedSource?.ready) {
      setError('请选择一个可用的交接目录');
      return;
    }
    if (mode === 'zip' && !file) {
      setError('请选择 zip 安装包');
      return;
    }

    setBusy(true);
    setError('');
    setProgress(null);
    try {
      let task: TaskInfo;
      if (mode === 'directory') {
        task = await api<TaskInfo>('/api/import/existing', {
          method: 'POST',
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
        const form = new FormData();
        form.append('name', name);
        form.append('coreType', coreType);
        if (mcVersion) form.append('mcVersion', mcVersion);
        form.append('jvmArgs', jvmArgs);
        form.append('acceptEula', acceptEula ? 'true' : 'false');
        if (javaRuntimeId) form.append('javaRuntimeId', javaRuntimeId);
        form.append('file', file!);
        task = await apiForm<TaskInfo>('/api/import', form);
      }

      setProgress(task);
      const result = await pollTask(task.id, (next) => setProgress(next as TaskInfo));
      if (result.instanceId) navigate(`/instances/${result.instanceId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

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
                        ? `${source.id} · ${source.launchTarget}`
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
              {!sourcesLoading && sources.length === 0 && (
                <p className="muted field-help">交接区暂无目录，请完成上面的复制步骤后刷新。</p>
              )}
              {selectedSource?.ready && (
                <p className="muted field-help">
                  已探测启动目标：<code>{selectedSource.launchTarget}</code>
                </p>
              )}
              {sourcesError && <p className="error">无法读取交接目录：{sourcesError}</p>}
            </div>
          </>
        ) : (
          <>
            <div className="managed-note">
              <strong>从 ZIP 创建托管副本</strong>
              <span>安装包会解压到新的 DATA_DIR/instances/&lt;实例 ID&gt;，不会覆盖已有实例。</span>
            </div>
            <div className="field">
              <label htmlFor="existing-server-zip">安装包（.zip）</label>
              <input
                id="existing-server-zip"
                type="file"
                accept=".zip,application/zip"
                disabled={busy}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                required={mode === 'zip'}
              />
            </div>
          </>
        )}

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

        <JavaEnvironmentStatus />
        <div className="field">
          <label htmlFor="import-jvm-args">JVM 参数</label>
          <input
            id="import-jvm-args"
            value={jvmArgs}
            disabled={busy}
            onChange={(e) => setJvmArgs(e.target.value)}
          />
        </div>
        <JavaRuntimeSelect
          value={javaRuntimeId}
          onChange={setJavaRuntimeId}
          mcVersion={mcVersion}
          disabled={busy}
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

        {error && <p className="error">{error}</p>}
        {progress && (
          <div className="import-progress">
            <div className="muted">
              {progress.message}（{Math.round(progress.progress)}%）
            </div>
            <div className="progress">
              <span style={{ width: `${progress.progress}%` }} />
            </div>
          </div>
        )}

        <button
          className="btn"
          type="submit"
          disabled={busy || (mode === 'directory' && !selectedSource?.ready)}
        >
          {busy ? '导入中…' : mode === 'directory' ? '复制并接管' : '上传并导入'}
        </button>
      </form>
    </div>
  );
}
