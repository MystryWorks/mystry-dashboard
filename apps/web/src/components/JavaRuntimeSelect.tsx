import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { recommendedJavaMajor, type JavaRuntimeInfo } from '@mmd/shared';
import { listJavaRuntimes } from '../api';

/**
 * Java 运行时选择器：
 * - 选项只来自面板探测并已验证的注册表，外加「默认（PATH 中的 java）」。
 * - 传入 mcVersion 时显示推荐版本，所选运行时不匹配给出告警。
 */
export function JavaRuntimeSelect({
  value,
  onChange,
  mcVersion,
  disabled = false,
}: {
  value: string | null;
  onChange: (runtimeId: string | null) => void;
  mcVersion?: string | null;
  disabled?: boolean;
}) {
  const selectId = useId();
  const [runtimes, setRuntimes] = useState<JavaRuntimeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  /** 加载代次：挂载加载与「重新探测」并发时，丢弃先发起但后到达的旧响应。 */
  const loadGenerationRef = useRef(0);

  const load = useCallback(async (refresh: boolean) => {
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    if (refresh) setRefreshing(true);
    try {
      const result = await listJavaRuntimes(refresh);
      if (generation !== loadGenerationRef.current) return;
      setRuntimes(result);
      setError('');
    } catch (err) {
      if (generation !== loadGenerationRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (generation === loadGenerationRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const recommended = recommendedJavaMajor(mcVersion);
  const selected = value ? runtimes.find((runtime) => runtime.id === value) ?? null : null;
  const mismatch =
    selected?.available && selected.majorVersion != null && recommended != null && selected.majorVersion !== recommended;

  return (
    <div className="field">
      <label htmlFor={selectId}>Java 运行时</label>
      <div className="btn-row" style={{ alignItems: 'stretch' }}>
        <select
          id={selectId}
          style={{ flex: 1, minWidth: 0 }}
          value={value ?? ''}
          disabled={disabled || loading}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">默认（PATH 中的 java）</option>
          {runtimes.map((runtime) => (
            <option key={runtime.id} value={runtime.id} disabled={!runtime.available}>
              {`Java ${runtime.majorVersion ?? runtime.version ?? '未知版本'} · ${runtime.path}${runtime.available ? '' : '（不可用）'}`}
            </option>
          ))}
        </select>
        <button
          className="btn btn-ghost"
          type="button"
          disabled={disabled || refreshing}
          title="重新扫描本机 Java 安装目录"
          onClick={() => void load(true)}
        >
          {refreshing ? '探测中…' : '重新探测'}
        </button>
      </div>
      {recommended != null && (
        <p className="muted field-help">当前 Minecraft {mcVersion} 推荐使用 Java {recommended}。</p>
      )}
      {mismatch && selected && (
        <p className="field-warn" role="alert">
          所选运行时为 Java {selected.majorVersion}，与推荐版本 Java {recommended} 不匹配，实例可能无法启动。
        </p>
      )}
      {value && !loading && (!selected || !selected.available) && (
        <p className="field-warn" role="alert">
          实例绑定的运行时已不可用，保存前请重新探测并选择其他运行时。
        </p>
      )}
      {error && <p className="error">无法读取 Java 运行时：{error}</p>}
    </div>
  );
}
