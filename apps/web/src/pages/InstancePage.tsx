import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useParams } from 'react-router-dom';
import type { FileEntry, InstanceInfo } from '@mmd/shared';
import { api } from '../api';
import { ConsolePanel } from '../components/ConsolePanel';

const statusLabel: Record<string, string> = {
  stopped: '已停止',
  starting: '启动中',
  running: '运行中',
  stopping: '停止中',
  crashed: '已崩溃',
};

function ConsoleTab({ instance }: { instance: InstanceInfo; onChange: () => void }) {
  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        状态：
        <span className={`badge ${instance.status}`}>{statusLabel[instance.status]}</span>
        （在终端输入指令后回车发送）
      </p>
      <ConsolePanel instanceId={instance.id} />
    </div>
  );
}

function MigrationPanel({ instance, onAdopt }: { instance: InstanceInfo; onAdopt: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function adopt() {
    setBusy(true); setError('');
    try { await api(`/api/instances/${instance.id}/adopt-managed-directory`, { method: 'POST' }); await onAdopt(); }
    catch (err) { setError(err instanceof Error ? err.message : '接管失败，请确认目录已复制完成。'); }
    finally { setBusy(false); }
  }
  return <div className="migration-panel"><span className="badge migration">需要迁移</span><h2>接管托管目录</h2>
    <p>请使用系统工具，将旧实例文件复制到配置的 DATA_DIR/instances/{instance.id}：</p><code>配置的 DATA_DIR/instances/{instance.id}</code>
    <p className="muted">面板不会读取或删除旧目录。复制完成后点击“接管托管目录”，成功后将恢复实例操作。</p>{error && <p className="error">{error}</p>}
    <button className="btn" type="button" disabled={busy} onClick={() => void adopt()}>{busy ? '检查中…' : '接管托管目录'}</button>
  </div>;
}

function FilesTab({ instanceId }: { instanceId: string }) {
  const [path, setPath] = useState('');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [editPath, setEditPath] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [newDir, setNewDir] = useState('');

  const load = useCallback(async () => {
    try {
      const list = await api<FileEntry[]>(
        `/api/instances/${instanceId}/files?path=${encodeURIComponent(path)}`,
      );
      setFiles(list);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [instanceId, path]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openFile(file: FileEntry) {
    if (file.isDirectory) {
      setPath(file.path);
      setEditPath(null);
      return;
    }
    try {
      const res = await api<{ content: string }>(
        `/api/instances/${instanceId}/files/content?path=${encodeURIComponent(file.path)}`,
      );
      setEditPath(file.path);
      setContent(res.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveFile() {
    if (!editPath) return;
    try {
      await api(`/api/instances/${instanceId}/files/content`, {
        method: 'PUT',
        json: { path: editPath, content },
      });
      setError('');
      alert('已保存');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function remove(file: FileEntry) {
    if (!confirm(`删除 ${file.name}？`)) return;
    try {
      await api(`/api/instances/${instanceId}/files?path=${encodeURIComponent(file.path)}`, {
        method: 'DELETE',
      });
      if (editPath === file.path) setEditPath(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      const token = localStorage.getItem('mmd_token');
      const res = await fetch(
        `/api/instances/${instanceId}/files/upload?path=${encodeURIComponent(path)}`,
        {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: form,
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '上传失败');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      e.target.value = '';
    }
  }

  async function createDir() {
    if (!newDir.trim()) return;
    const target = path ? `${path}/${newDir.trim()}` : newDir.trim();
    try {
      await api(`/api/instances/${instanceId}/files/mkdir`, {
        method: 'POST',
        json: { path: target },
      });
      setNewDir('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function goUp() {
    if (!path) return;
    const parts = path.split('/').filter(Boolean);
    parts.pop();
    setPath(parts.join('/'));
  }

  return (
    <div className="grid grid-2">
      <div className="panel">
        <div className="btn-row" style={{ marginBottom: '0.75rem' }}>
          <button className="btn btn-ghost" type="button" onClick={goUp} disabled={!path}>
            上级
          </button>
          <label className="btn btn-ghost" style={{ cursor: 'pointer' }}>
            上传
            <input type="file" hidden onChange={(e) => void upload(e)} />
          </label>
        </div>
        <p className="muted">当前路径：/{path || ''}</p>
        {error && <p className="error">{error}</p>}
        <ul className="file-list">
          {files.map((f) => (
            <li key={f.path}>
              <button className="linkish" type="button" onClick={() => void openFile(f)}>
                {f.isDirectory ? '📁 ' : '📄 '}
                {f.name}
              </button>
              <button className="btn btn-ghost" type="button" onClick={() => void remove(f)}>
                删除
              </button>
            </li>
          ))}
        </ul>
        <div className="field" style={{ marginTop: '1rem' }}>
          <label>新建文件夹</label>
          <div className="btn-row">
            <input value={newDir} onChange={(e) => setNewDir(e.target.value)} placeholder="目录名" />
            <button className="btn btn-ghost" type="button" onClick={() => void createDir()}>
              创建
            </button>
          </div>
        </div>
      </div>
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>{editPath ? `编辑：${editPath}` : '选择文件进行编辑'}</h3>
        {editPath ? (
          <>
            <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={18} />
            <button className="btn" type="button" onClick={() => void saveFile()}>
              保存
            </button>
          </>
        ) : (
          <p className="muted">点击左侧文本文件即可编辑。</p>
        )}
      </div>
    </div>
  );
}

function ConfigTab({ instanceId }: { instanceId: string }) {
  const [props, setProps] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setProps(await api(`/api/instances/${instanceId}/config/server.properties`));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [instanceId]);

  async function save() {
    try {
      await api(`/api/instances/${instanceId}/config/server.properties`, {
        method: 'PUT',
        json: props,
      });
      setSaved(true);
      setError('');
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const keys = Object.keys(props).sort();

  return (
    <div className="panel">
      <p className="page-desc">编辑 server.properties（修改后需重启实例生效）。</p>
      {error && <p className="error">{error}</p>}
      {saved && <p className="muted">已保存</p>}
      <div className="grid grid-2">
        {keys.map((key) => (
          <div className="field" key={key}>
            <label>{key}</label>
            <input
              value={props[key] ?? ''}
              onChange={(e) => setProps((p) => ({ ...p, [key]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      <button className="btn" type="button" onClick={() => void save()}>
        保存配置
      </button>
    </div>
  );
}

function SettingsTab({
  instance,
  onSaved,
}: {
  instance: InstanceInfo;
  onSaved: () => void;
}) {
  const [name, setName] = useState(instance.name);
  const [jarFile, setJarFile] = useState(instance.jarFile);
  const [jvmArgs, setJvmArgs] = useState(instance.jvmArgs);
  const [acceptEula, setAcceptEula] = useState(instance.acceptEula);
  const [error, setError] = useState('');

  async function save() {
    try {
      await api(`/api/instances/${instance.id}`, {
        method: 'PATCH',
        json: { name, jarFile, jvmArgs, acceptEula },
      });
      setError('');
      onSaved();
      alert('设置已保存');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="panel" style={{ maxWidth: 640 }}>
      {error && <p className="error">{error}</p>}
      <div className="field">
        <label>名称</label>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label>Jar 文件名</label>
        <input value={jarFile} onChange={(e) => setJarFile(e.target.value)} />
      </div>
      <div className="field">
        <label>安装路径</label>
        <input value={instance.installPath ?? `配置的 DATA_DIR/instances/${instance.id}`} readOnly />
        <p className="muted" style={{ margin: '0.25rem 0 0', fontSize: '0.8rem' }}>
          实例目录由面板托管，创建后不可修改。
        </p>
      </div>
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
        启动时自动写入 eula=true
      </label>
      <button className="btn" type="button" onClick={() => void save()}>
        保存设置
      </button>
    </div>
  );
}

export function InstancePage() {
  const { id = '' } = useParams();
  const [instance, setInstance] = useState<InstanceInfo | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setInstance(await api<InstanceInfo>(`/api/instances/${id}`));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [id]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [load]);

  async function act(action: 'start' | 'stop' | 'restart') {
    setBusy(true);
    try {
      await api(`/api/instances/${id}/${action}`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!instance) {
    return <p>{error || '加载中…'}</p>;
  }

  return (
    <div>
      <p>
        <Link to="/">← 返回总览</Link>
      </p>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">{instance.name}</h1>
          <p className="page-desc">
            {instance.coreType} {instance.mcVersion || ''} ·{' '}
            <span className={`badge ${instance.status}`}>{statusLabel[instance.status]}</span>
          </p>
        </div>
        <div className="btn-row">
          <button className="btn" type="button" disabled={busy || instance.requiresMigration} onClick={() => void act('start')}>
            启动
          </button>
          <button className="btn btn-ghost" type="button" disabled={busy || instance.requiresMigration} onClick={() => void act('stop')}>
            停止
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            disabled={busy || instance.requiresMigration}
            onClick={() => void act('restart')}
          >
            重启
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {instance.requiresMigration ? <MigrationPanel instance={instance} onAdopt={load} /> : <>
      <div className="tabs">
        <NavLink to={`/instances/${id}`} end className={({ isActive }) => (isActive ? 'active' : undefined)}>
          控制台
        </NavLink>
        <NavLink
          to={`/instances/${id}/files`}
          className={({ isActive }) => (isActive ? 'active' : undefined)}
        >
          文件
        </NavLink>
        <NavLink
          to={`/instances/${id}/config`}
          className={({ isActive }) => (isActive ? 'active' : undefined)}
        >
          配置
        </NavLink>
        <NavLink
          to={`/instances/${id}/settings`}
          className={({ isActive }) => (isActive ? 'active' : undefined)}
        >
          设置
        </NavLink>
      </div>

      <Routes>
        <Route index element={<ConsoleTab instance={instance} onChange={load} />} />
        <Route path="files" element={<FilesTab instanceId={instance.id} />} />
        <Route path="config" element={<ConfigTab instanceId={instance.id} />} />
        <Route path="settings" element={<SettingsTab instance={instance} onSaved={load} />} />
      </Routes></>}
    </div>
  );
}
