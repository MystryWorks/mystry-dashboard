import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical } from 'lucide-react';

const PANEL_GAP = 6;
const VIEWPORT_MARGIN = 8;

export type ActionMenuItem = {
  key: string;
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
  onSelect: () => void;
};

type PanelStyle = {
  top: number;
  right: number;
  maxHeight: number;
};

/**
 * 卡片内的「更多操作」菜单。
 * 面板通过 portal 挂到 body 并使用 fixed 定位，避免被卡片的 overflow 裁剪；
 * 统一在触发按钮下方右对齐展开，仅在下方空间不足且上方更宽裕时翻到上方。
 */
export function ActionMenu({
  label = '更多操作',
  items,
}: {
  label?: string;
  items: ActionMenuItem[];
}) {
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<PanelStyle | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewportHeight = document.documentElement.clientHeight;
    const viewportWidth = document.documentElement.clientWidth;
    const panelHeight = panelRef.current?.scrollHeight ?? 0;
    const availableBelow = Math.max(0, viewportHeight - rect.bottom - PANEL_GAP - VIEWPORT_MARGIN);
    const availableAbove = Math.max(0, rect.top - PANEL_GAP - VIEWPORT_MARGIN);
    const placeAbove = availableBelow < panelHeight && availableAbove > availableBelow;
    const maxHeight = placeAbove ? availableAbove : availableBelow;
    const height = Math.min(panelHeight, maxHeight);
    setPanelStyle({
      top: placeAbove ? rect.top - PANEL_GAP - height : rect.bottom + PANEL_GAP,
      right: Math.max(VIEWPORT_MARGIN, viewportWidth - rect.right),
      maxHeight,
    });
  }, []);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    setPanelStyle(null);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // 面板渲染后、浏览器绘制前完成定位，避免先在错误位置闪一帧。
  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    panelRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
      ?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(event: MouseEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      close(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open, close]);

  function onPanelKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === 'Tab') {
      // 焦点先回到触发按钮，再由浏览器默认行为移到其前/后的元素。
      close(true);
      return;
    }
    const enabled = [
      ...(panelRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []),
    ];
    if (enabled.length === 0) return;
    const index = enabled.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (event.key === 'ArrowDown') next = (index + 1) % enabled.length;
    if (event.key === 'ArrowUp') next = index <= 0 ? enabled.length - 1 : index - 1;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = enabled.length - 1;
    if (next < 0) return;
    event.preventDefault();
    enabled[next]?.focus();
  }

  function onTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      close(true);
    } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !open) {
      event.preventDefault();
      setOpen(true);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`btn btn-icon action-menu-trigger${open ? ' is-open' : ''}`}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={onTriggerKeyDown}
      >
        <MoreVertical size={16} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            id={panelId}
            ref={panelRef}
            className="action-menu-panel"
            role="menu"
            aria-label={label}
            // 首帧尚未测量时透明（仍可聚焦），避免在左上角闪现。
            style={panelStyle ?? { opacity: 0, top: 0, right: 0 }}
            onKeyDown={onPanelKeyDown}
          >
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={`btn ${item.danger ? 'btn-danger' : 'btn-ghost'}`}
                disabled={item.disabled}
                title={item.title}
                onClick={() => {
                  // 先把焦点交还触发按钮，确认弹窗关闭后浏览器会恢复到这里。
                  close(true);
                  item.onSelect();
                }}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
