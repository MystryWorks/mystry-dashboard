/** PaperMC 要求 User-Agent 标明软件名与联系方式 */
export const USER_AGENT = 'MinecraftMystryDashboard/0.2 (+https://github.com/MystryWorks/mystry-dashboard)';

export function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error && [
    '任务执行超时',
    '核心下载超时',
    '核心元数据请求超时',
    '任务已取消',
  ].includes(signal.reason.message)) {
    return signal.reason;
  }
  return new Error('任务已取消');
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal);
}
