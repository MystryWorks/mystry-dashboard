import { useEffect, useId, useRef, useState } from 'react';
import { Palette } from 'lucide-react';
import {
  getTheme,
  setTheme,
  THEME_CHANGE_EVENT,
  THEME_FAMILIES,
  THEME_META,
  type Theme,
} from '../theme';

type Placement = 'sidebar' | 'topbar' | 'login';

/**
 * 主题选择器：按套分组，每套可选暗色或亮色。
 * 多处渲染时通过主题事件同步当前项；面板用 fixed 定位避免侧栏 overflow 裁切。
 */
export function ThemeToggle({ placement = 'sidebar' }: { placement?: Placement }) {
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    const onChange = () => setThemeState(getTheme());
    window.addEventListener(THEME_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (!open) return;
    function updatePosition() {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const gap = 8;
      const menuWidth = 268;
      if (placement === 'sidebar') {
        setPanelStyle({
          left: Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8)),
          bottom: window.innerHeight - rect.top + gap,
        });
      } else {
        setPanelStyle({
          top: rect.bottom + gap,
          right: Math.max(8, window.innerWidth - rect.right),
        });
      }
    }
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, placement]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        toggleRef.current?.focus();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
        return;
      }
      const options = [...(panelRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
      if (options.length === 0) return;
      const index = options.indexOf(document.activeElement as HTMLButtonElement);
      const current = index < 0 ? 0 : index;
      let nextIndex = current;
      if (event.key === 'ArrowDown') nextIndex = (current + 2) % options.length;
      if (event.key === 'ArrowUp') nextIndex = (current - 2 + options.length) % options.length;
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') nextIndex = current ^ 1;
      event.preventDefault();
      options[nextIndex]?.focus();
    }

    function onMouseDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [open]);

  function choose(next: Theme) {
    setTheme(next);
    setOpen(false);
    toggleRef.current?.focus();
  }

  return (
    <div className={`theme-picker theme-picker-${placement}`} ref={rootRef}>
      <button
        ref={toggleRef}
        type="button"
        className="task-center-toggle"
        aria-label={`选择主题，当前为${THEME_META[theme].label}`}
        title="选择主题"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <Palette size={18} aria-hidden="true" />
      </button>

      {open && (
        <div
          id={panelId}
          ref={panelRef}
          className="theme-menu"
          style={panelStyle}
          role="listbox"
          aria-label="主题"
        >
          {THEME_FAMILIES.map((family) => (
            <div key={family.id} className="theme-family" role="group" aria-label={family.label}>
              <p className="theme-family-label">{family.label}</p>
              <div className="theme-family-options">
                {family.themes.map((id) => {
                  const meta = THEME_META[id];
                  const selected = theme === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="option"
                      aria-label={meta.label}
                      aria-selected={selected}
                      className={`theme-option${selected ? ' is-selected' : ''}`}
                      onClick={() => choose(id)}
                    >
                      <span className={`theme-swatch theme-swatch-${id}`} aria-hidden="true" />
                      <span>{meta.shortLabel}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
