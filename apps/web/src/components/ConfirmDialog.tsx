import { useEffect, useId, useRef, useState } from 'react';

/**
 * 通用确认弹窗：替代原生 confirm()。
 * 传入 requireText 时，必须输入完全一致的文本才能确认（用于删除实例等高危操作）。
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '确认',
  danger = false,
  busy = false,
  confirmDisabled = false,
  requireText,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  /** 表单内容尚未通过校验时禁用确认，但不进入 busy 锁。 */
  confirmDisabled?: boolean;
  /** 需要输入完全一致的确认文本（如实例名） */
  requireText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState('');
  const titleId = useId();
  const inputId = useId();
  /** 同一打开周期内只触发一次取消，避免 close 事件与按钮 onClick 双路径重复调用。 */
  const cancelHandledRef = useRef(false);

  function handleCancel(): void {
    // 请求执行期间禁止 Escape、遮罩和关闭事件绕过 busy 锁。
    if (busy || cancelHandledRef.current) return;
    cancelHandledRef.current = true;
    onCancel();
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (open) setTyped('');
    cancelHandledRef.current = false;
  }, [open]);

  const needText = Boolean(requireText);
  const canConfirm = !busy && !confirmDisabled && (!needText || typed === requireText);

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog"
      aria-labelledby={titleId}
      onClose={handleCancel}
      onCancel={(event) => {
        event.preventDefault();
        handleCancel();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) handleCancel();
      }}
    >
      <div className="confirm-dialog-panel">
        <h2 id={titleId} className="confirm-dialog-title">
          {title}
        </h2>
        <div className="confirm-dialog-body">{description}</div>
        {needText && (
          <div className="field">
            <label htmlFor={inputId}>
              请输入「{requireText}」以确认操作
            </label>
            <input
              id={inputId}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              autoFocus
            />
          </div>
        )}
        <footer className="confirm-dialog-footer">
          <button className="btn btn-ghost" type="button" disabled={busy} onClick={handleCancel}>
            取消
          </button>
          <button
            className={`btn${danger ? ' btn-danger' : ''}`}
            type="button"
            disabled={!canConfirm}
            onClick={onConfirm}
          >
            {busy ? '处理中…' : confirmLabel}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
