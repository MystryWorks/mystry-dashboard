import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TaskInfo } from '@mmd/shared';
import { apiForm, pollTask } from '../api';
import { JavaEnvironmentStatus } from '../components/PathFields';

export function ImportPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('导入的服务器');
  const [file, setFile] = useState<File | null>(null);
  const [jvmArgs, setJvmArgs] = useState('-Xms1G -Xmx2G');
  const [acceptEula, setAcceptEula] = useState(true);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<TaskInfo | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError('请选择 zip 安装包');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.append('name', name);
      form.append('jvmArgs', jvmArgs);
      form.append('acceptEula', acceptEula ? 'true' : 'false');
      form.append('file', file);
      const task = await apiForm<TaskInfo>('/api/import', form);
      setProgress(task);
      const result = await pollTask(task.id, (t) => setProgress(t as TaskInfo));
      if (result.instanceId) navigate(`/instances/${result.instanceId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="page-title">导入安装包</h1>
      <p className="page-desc">上传现成的服务端 zip，自动解压并探测 jar。</p>

      <form className="panel" style={{ maxWidth: 640 }} onSubmit={(e) => void onSubmit(e)}>
        <div className="field">
          <label>实例名称</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="managed-note"><strong>实例目录由面板托管</strong><span>导入内容会放入 data/instances/&lt;实例 ID&gt;。</span></div>
        <div className="field">
          <label>安装包（.zip）</label>
          <input
            type="file"
            accept=".zip,application/zip"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            required
          />
        </div>
        <JavaEnvironmentStatus />
        <div className="field">
          <label>JVM 参数</label>
          <input value={jvmArgs} onChange={(e) => setJvmArgs(e.target.value)} />
        </div>
        <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem' }}>
          <input
            type="checkbox"
            checked={acceptEula}
            onChange={(e) => setAcceptEula(e.target.checked)}
          />
          自动接受 Mojang EULA（eula=true）
        </label>

        {error && <p className="error">{error}</p>}
        {progress && (
          <div style={{ marginBottom: '1rem' }}>
            <div className="muted">
              {progress.message}（{Math.round(progress.progress)}%）
            </div>
            <div className="progress">
              <span style={{ width: `${progress.progress}%` }} />
            </div>
          </div>
        )}

        <button className="btn" type="submit" disabled={busy}>
          {busy ? '导入中…' : '开始导入'}
        </button>
      </form>
    </div>
  );
}
