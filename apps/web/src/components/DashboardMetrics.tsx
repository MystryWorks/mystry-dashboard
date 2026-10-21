import { useCallback, useEffect, useRef, useState } from 'react';
import type { DashboardMetrics as Metrics, InstanceInfo } from '@mmd/shared';
import { api } from '../api';

export function gib(bytes: number): string { return (bytes / 1024 ** 3).toFixed(1); }

export function processMetric(inst: InstanceInfo, metrics: Metrics | null, error: string, kind: 'cpu' | 'memory'): string {
  if (!['running', 'starting', 'stopping'].includes(inst.status)) return '—';
  const sample = metrics?.instances[inst.id];
  const value = kind === 'cpu' ? sample?.cpuPercent : sample?.memoryBytes;
  if (value != null) return `${kind === 'cpu' ? `${value.toFixed(1)}%` : `${gib(value)} GiB`}${error ? '（过期）' : ''}`;
  return error || sample?.state === 'unavailable' ? '暂不可用' : '采集中…';
}

export function useDashboardMetrics() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(false);
  const refresh = useCallback(async () => {
    if (pending.current || document.hidden) return;
    pending.current = true; setBusy(true);
    try {
      const result = await api<Metrics>('/api/system/metrics');
      if (!result.memory || !result.instances || !Array.isArray(result.warnings)) throw new Error('监测数据暂不可用');
      if (mounted.current) { setMetrics(result); setError(''); }
    } catch {
      if (mounted.current) setError('监测数据获取失败');
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    const visible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => { mounted.current = false; clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);
  return { metrics, error, busy, refresh };
}

export function HostMetricCards({ metrics, error }: { metrics: Metrics | null; error: string }) {
  return <>{[
    { label: '主机 CPU', value: metrics?.cpuPercent == null ? (error ? '暂不可用' : '采集中…') : `${metrics.cpuPercent.toFixed(1)}%`, detail: '整机逻辑核总容量', ratio: metrics?.cpuPercent, warning: metrics?.warnings.includes('主机 CPU 持续偏高') },
    { label: '主机内存', value: metrics ? `${gib(metrics.memory.usedBytes)} / ${gib(metrics.memory.totalBytes)}` : (error ? '暂不可用' : '采集中…'), detail: 'GiB · 已用 / 总量', ratio: metrics ? metrics.memory.usedBytes / metrics.memory.totalBytes * 100 : null, warning: metrics?.warnings.includes('主机内存持续偏高') },
    { label: '数据盘空间', value: metrics?.disk ? `${gib(metrics.disk.availableBytes)} GiB` : (metrics || error ? '暂不可用' : '采集中…'), detail: '剩余空间 · 数据目录所在磁盘', ratio: metrics?.disk ? (1 - metrics.disk.availableBytes / metrics.disk.totalBytes) * 100 : null, warning: metrics?.warnings.includes('数据盘剩余空间不足') },
  ].map(item => <div key={item.label} className={`metric-card${item.warning ? ' metric-warning' : ''}`}>
    <div className="metric-header">{item.label}</div>
    <div className="metric-value">{item.value}</div>
    <div className="metric-detail">{item.detail}</div>
    <div className="metric-bar" aria-hidden="true"><div className="metric-bar-fill" style={{ width: `${Math.max(0, Math.min(100, item.ratio || 0))}%` }} /></div>
  </div>)}</>;
}
