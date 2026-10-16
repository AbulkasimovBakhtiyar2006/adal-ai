import { useEffect, useId, useRef } from 'react'
import { useI18n } from '../i18n/context'

interface ConfirmDialogProps {
  title: string
  text: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

/** Подтверждение необратимого действия. Esc и клик по фону — отмена. */
export function ConfirmDialog({ title, text, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  const { t } = useI18n()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const textId = useId()

  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={textId}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={titleId} className="modal__title">
          {title}
        </h2>
        <p id={textId}>{text}</p>
        <div className="modal__actions">
          <button type="button" className="btn btn--secondary" ref={cancelRef} onClick={onCancel}>
            {t.cancel}
          </button>
          <button type="button" className="btn btn--danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
