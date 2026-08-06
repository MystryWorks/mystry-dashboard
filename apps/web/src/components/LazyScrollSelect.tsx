import { useEffect, useId, useRef, useState } from 'react';

const PAGE_SIZE = 10;

type LazyScrollSelectProps<T extends string | number> = {
  value: T | '';
  options: T[];
  onChange: (value: T) => void;
  disabled?: boolean;
  loading?: boolean;
  /** 展开面板时回调（用于按需拉取选项） */
  onOpen?: () => void;
  formatLabel?: (value: T) => string;
  placeholder?: string;
  emptyText?: string;
  /** 读屏与无障碍名称 */
  ariaLabel: string;
};

/** 根据选中项索引计算至少需要展示多少条，保证已选项在列表内 */
function countForSelectedIndex(index: number, total: number): number {
  if (index < 0) return Math.min(PAGE_SIZE, total);
  return Math.min(Math.ceil((index + 1) / PAGE_SIZE) * PAGE_SIZE, total);
}

export function LazyScrollSelect<T extends string | number>({
  value,
  options,
  onChange,
  disabled = false,
  loading = false,
  onOpen,
  formatLabel = (v) => String(v),
  placeholder = '请选择',
  emptyText = '暂无选项',
  ariaLabel,
}: LazyScrollSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();

  // 选项变化时重置可见数量
  useEffect(() => {
    const index = value === '' ? -1 : options.indexOf(value as T);
    setVisibleCount(countForSelectedIndex(index, options.length));
  }, [options, value]);

  useEffect(() => {
    if (!open) {
      setActiveIndex(-1);
      return;
    }
    const selectedIndex = value === '' ? -1 : options.indexOf(value as T);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, options, value]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.focus();
  }, [open]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  function closePanel(returnFocus = true) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function openPanel() {
    if (disabled) return;
    const index = value === '' ? -1 : options.indexOf(value as T);
    setVisibleCount(countForSelectedIndex(index, options.length));
    setOpen(true);
    onOpen?.();
  }

  function handleScroll() {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (nearBottom) {
      setVisibleCount((n) => Math.min(n + PAGE_SIZE, options.length));
    }
  }

  function selectOption(opt: T) {
    onChange(opt);
    closePanel(true);
  }

  function moveActive(delta: number) {
    if (options.length === 0) return;
    setActiveIndex((current) => {
      const base = current < 0 ? 0 : current;
      const next = Math.max(0, Math.min(options.length - 1, base + delta));
      if (next >= visibleCount - 1 && visibleCount < options.length) {
        setVisibleCount((count) => Math.min(count + PAGE_SIZE, options.length));
      }
      return next;
    });
  }

  function onTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!open) openPanel();
      else if (event.key === 'Enter' || event.key === ' ') {
        const opt = options[activeIndex];
        if (opt !== undefined) selectOption(opt);
      }
      return;
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      closePanel(true);
    }
  }

  function onPanelKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closePanel(true);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(Math.max(0, options.length - 1));
      setVisibleCount(options.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const opt = options[activeIndex];
      if (opt !== undefined) selectOption(opt);
    }
  }

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const panel = listRef.current;
    const option = panel?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`);
    option?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const display =
    value === '' || (typeof value === 'number' && Number.isNaN(value))
      ? placeholder
      : formatLabel(value as T);
  const hasValue = value !== '';
  const visibleOptions = options.slice(0, visibleCount);

  return (
    <div className={`lazy-select${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="lazy-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={ariaLabel}
        onClick={() => (open ? closePanel(true) : openPanel())}
        onKeyDown={onTriggerKeyDown}
      >
        <span className={hasValue ? undefined : 'lazy-select-placeholder'}>{display}</span>
        <span className="lazy-select-chevron" aria-hidden />
      </button>
      {open && (
        <div
          id={listboxId}
          className="lazy-select-panel"
          role="listbox"
          aria-label={ariaLabel}
          ref={listRef}
          onScroll={handleScroll}
          onKeyDown={onPanelKeyDown}
          tabIndex={-1}
        >
          {loading && options.length === 0 && (
            <div className="lazy-select-more muted">加载中…</div>
          )}
          {!loading && options.length === 0 && (
            <div className="lazy-select-more muted">{emptyText}</div>
          )}
          {visibleOptions.map((opt, index) => {
            const selected = opt === value;
            const active = index === activeIndex;
            return (
              <button
                key={String(opt)}
                type="button"
                role="option"
                data-option-index={index}
                aria-selected={selected}
                className={`lazy-select-option${selected ? ' is-selected' : ''}${active ? ' is-active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectOption(opt)}
              >
                {formatLabel(opt)}
              </button>
            );
          })}
          {visibleCount < options.length && (
            <div className="lazy-select-more muted">向下滚动加载更多…</div>
          )}
        </div>
      )}
    </div>
  );
}
