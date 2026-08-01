import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { getTheme, setTheme, THEME_CHANGE_EVENT, type Theme } from '../theme';

/** 亮/暗主题切换按钮；多处渲染时通过主题事件保持状态同步。 */
export function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme>(getTheme);

  useEffect(() => {
    const onChange = () => setThemeState(getTheme());
    window.addEventListener(THEME_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, onChange);
  }, []);

  const next: Theme = theme === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      className="task-center-toggle"
      aria-label={next === 'light' ? '切换到亮色主题' : '切换到暗色主题'}
      title={next === 'light' ? '切换到亮色主题' : '切换到暗色主题'}
      onClick={() => setTheme(next)}
    >
      {theme === 'dark' ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
    </button>
  );
}
