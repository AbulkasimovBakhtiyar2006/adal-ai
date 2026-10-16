import { useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from 'react'
import { useI18n } from '../i18n/context'
import { ApiError, uploadChatFile } from '../api/client'
import type { ChatAttachment } from '../api/types'
import { PaperclipIcon, SendIcon } from './Icons'

interface ComposerProps {
  value: string
  onChange: (value: string) => void
  onSubmit: (attachments: ChatAttachment[]) => void
  busy: boolean
  disabled: boolean
  maxChars: number
  inputRef: RefObject<HTMLTextAreaElement | null>
}

/** Поле ввода. Пока ИИ отвечает, писать можно, но отправить нельзя. */
export function Composer({ value, onChange, onSubmit, busy, disabled, maxChars, inputRef }: ComposerProps) {
  const { t } = useI18n()
  const fileInput = useRef<HTMLInputElement>(null)
  const uploadingRef = useRef(false)
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [fileError, setFileError] = useState('')
  const addFiles = async (files: File[]) => {
    if (busy || disabled || uploadingRef.current || !files.length) return
    if (files.length + attachments.length > 3) { setFileError(t.files.limit); return }
    uploadingRef.current = true
    setUploading(true)
    setFileError('')
    try {
      for (const file of files) {
        if (!/\.(pdf|docx|txt|md)$/i.test(file.name)) throw new ApiError('FILE_UNSUPPORTED')
        if (file.size > 12 * 1024 * 1024) throw new ApiError('FILE_TOO_LARGE')
        const attachment = await uploadChatFile(file)
        setAttachments(items => [...items, attachment])
      }
    } catch (err) {
      setFileError(t.errors[err instanceof ApiError ? err.code : 'FILE_UNREADABLE'])
    } finally { setUploading(false); uploadingRef.current = false }
  }
  const send = () => {
    onSubmit(attachments)
    setAttachments([])
    setFileError('')
  }
  const length = value.trim().length
  const tooLong = length > maxChars
  const canSend = !busy && !disabled && !uploading && (length > 0 || attachments.length > 0) && !tooLong

  // Высота поля подстраивается под текст; верхний предел задан в CSS (max-height).
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value, inputRef])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (canSend) send()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      if (canSend) send()
    }
  }

  const showCounter = length > maxChars * 0.8

  return (
    <form className="composer" onSubmit={submit}>
      <label htmlFor="composer-input" className="composer__label">
        {t.inputLabel}
      </label>
      {!!attachments.length && <ul className="composer-files" aria-label={t.files.attached}>
        {attachments.map((file, index) => <li key={index}>
          <PaperclipIcon /><span title={file.name}>{file.name}<small>{Math.max(1, Math.ceil(file.size / 1024))} KB</small></span>
          <button type="button" disabled={uploading || busy || disabled} aria-label={`${t.files.remove}: ${file.name}`}
            onClick={() => { setAttachments(items => items.filter((_, i) => i !== index)); setFileError('') }}>×</button>
        </li>)}
      </ul>}
      <input ref={fileInput} className="visually-hidden" type="file" multiple tabIndex={-1}
        aria-label={t.files.attach} accept=".pdf,.docx,.txt,.md" disabled={busy || disabled || uploading}
        onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void addFiles(files) }} />
      <div className="composer__row">
        <button type="button" className="btn btn--ghost composer__attach" aria-label={t.files.attach}
          title={t.files.attach} disabled={busy || disabled || uploading || attachments.length >= 3}
          onClick={() => fileInput.current?.click()}><PaperclipIcon /></button>
        <textarea
          id="composer-input"
          aria-label={t.inputLabel}
          ref={inputRef}
          className="composer__input"
          rows={1}
          value={value}
          placeholder={t.inputPlaceholder}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          aria-invalid={tooLong || undefined}
          aria-describedby={tooLong || showCounter ? 'composer-hint' : undefined}
        />
        <button
          type="submit"
          className="btn btn--primary btn--send"
          disabled={!canSend}
          aria-label={t.send}
          title={t.send}
        >
          <SendIcon />
          <span>{t.send}</span>
        </button>
      </div>
      <p className="composer__file-hint">{t.files.hint}</p>
      {uploading && <p className="composer__file-hint" role="status">{t.files.uploading}</p>}
      {fileError && <p className="composer__error" role="alert">{fileError}</p>}
      {(tooLong || showCounter) && <div className="composer__meta" id="composer-hint">
        {tooLong && (
          <span className="composer__error">{t.tooLong(maxChars)}</span>
        )}
        {showCounter && (
          <span className={tooLong ? 'composer__counter composer__counter--over' : 'composer__counter'}>
            {length} / {maxChars}
          </span>
        )}
      </div>}
    </form>
  )
}
