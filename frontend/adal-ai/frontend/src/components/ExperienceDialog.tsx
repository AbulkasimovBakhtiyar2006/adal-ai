import { useEffect, useRef, type ReactNode } from 'react'
import { useI18n } from '../i18n/context'
import { experienceCopy } from '../experience/content'
export function ExperienceDialog({ titleId, onClose, children, className = '' }: { titleId: string; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  const { lang } = useI18n()
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const dialog = ref.current
    dialog?.showModal()
    return () => { dialog?.close(); if (previous?.isConnected) previous.focus() }
  }, [])
  return <dialog className={`experience-dialog ${className}`} ref={ref} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose() }} onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="experience-dialog__body"><button className="dialog-close" aria-label={experienceCopy[lang].close} onClick={onClose}><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.7" /></svg></button>{children}</div>
  </dialog>
}
