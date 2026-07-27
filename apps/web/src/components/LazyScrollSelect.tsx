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
}: LazyScrollSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  // 选项变化时重置可见数量
  useEffect(() => {
    const index = value === '' ? -1 : options.indexOf(value as T);
    setVisibleCount(countForSelectedIndex(index, options.length));
  }, [options, value]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

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
    setOpen(false);
  }

  const display =
    value === '' || (typeof value === 'number' && Number.isNaN(value))
      ? placeholder
      : formatLabel(value as T);
  // 已选值即使不在当前 options（例如尚未重新加载）也显示文案
  const hasValue = value !== '';
  const visibleOptions = options.slice(0, visibleCount);

  return (
    <div className={`lazy-select${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="lazy-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => (open ? setOpen(false) : openPanel())}
      >
        <span className={hasValue ? undefined : 'lazy-select-placeholder'}>{display}</span>
        <span className="lazy-select-chevron" aria-hidden />
      </button>
      {open && (
        <div
          id={listboxId}
          className="lazy-select-panel"
          role="listbox"
          ref={listRef}
          onScroll={handleScroll}
        >
          {loading && options.length === 0 && (
            <div className="lazy-select-more muted">加载中…</div>
          )}
          {!loading && options.length === 0 && (
            <div className="lazy-select-more muted">{emptyText}</div>
          )}
          {visibleOptions.map((opt) => {
            const selected = opt === value;
            return (
              <button
                key={String(opt)}
                type="button"
                role="option"
                aria-selected={selected}
                className={`lazy-select-option${selected ? ' is-selected' : ''}`}
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
