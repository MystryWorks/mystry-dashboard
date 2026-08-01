/**
 * 主题管理：'dark' | 'light'，持久化到 localStorage。
 * 初始值由 index.html 内联脚本在渲染前写入 <html data-theme>（跟随系统偏好），
 * 这里只负责读取当前值和切换，切换时广播事件让多个开关保持同步。
 */

export type Theme = 'dark' | 'light';

const THEME_KEY = 'mmd_theme';
export const THEME_CHANGE_EVENT = 'mmd:theme-change';

export function getTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* 隐私模式等场景下静默降级为仅本次会话生效 */
  }
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT));
}
