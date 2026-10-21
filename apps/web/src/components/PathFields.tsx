import { useEffect, useState } from 'react';
import { api } from '../api';

/** 只读显示服务器 PATH 中的 Java 环境。 */
export function JavaEnvironmentStatus() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void api<{ available: boolean; version: string | null }>('/api/system/java')
      .then((res) => { setAvailable(res.available); setVersion(res.version); })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <div className="field">
      <label>Java 环境</label>
      <div className={`environment-status ${available === false ? 'is-missing' : ''}`}>
        <span className="environment-dot" />
        {available === null ? '正在检查 PATH 中的 Java…' : available ? `PATH 中的 Java 可用${version ? ` · ${version}` : ''}` : 'PATH 中未找到可用的 Java'}
      </div>
      <p className="muted field-help">实例默认使用 PATH 中的 java；也可以在下方选择面板探测到的其他 Java 运行时。</p>
      {error && <p className="error">无法读取 Java 环境：{error}</p>}
    </div>
  );
}
