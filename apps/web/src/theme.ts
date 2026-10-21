/**
 * 主题管理：Mystry / Codex / Grok，各有暗色与亮色。
 * 初始值由 index.html 内联脚本在渲染前写入 <html data-theme>
 *（未保存时跟随系统偏好，仅在 Mystry 暗/亮之间选择），
 * 这里负责读取、校验、切换，并广播事件让多处选择器保持同步。
 */

export const THEMES = ['dark', 'light', 'codex', 'codex-light', 'grok', 'grok-light'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_META: Record<Theme, { label: string; shortLabel: string }> = {
  dark: { label: 'Mystry 暗色', shortLabel: '暗色' },
  light: { label: 'Mystry 亮色', shortLabel: '亮色' },
  codex: { label: 'Codex 暗色', shortLabel: '暗色' },
  'codex-light': { label: 'Codex 亮色', shortLabel: '亮色' },
  grok: { label: 'Grok 暗色', shortLabel: '暗色' },
  'grok-light': { label: 'Grok 亮色', shortLabel: '亮色' },
};

export const THEME_FAMILIES: { id: string; label: string; themes: readonly Theme[] }[] = [
  { id: 'mystry', label: 'Mystry', themes: ['dark', 'light'] },
  { id: 'codex', label: 'Codex', themes: ['codex', 'codex-light'] },
  { id: 'grok', label: 'Grok', themes: ['grok', 'grok-light'] },
];

const THEME_KEY = 'mystry_theme';
export const THEME_CHANGE_EVENT = 'mystry:theme-change';

export function isTheme(value: string | null | undefined): value is Theme {
  return (THEMES as readonly string[]).includes(value ?? '');
}

export function getTheme(): Theme {
  const current = document.documentElement.dataset.theme;
  return isTheme(current) ? current : 'dark';
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
