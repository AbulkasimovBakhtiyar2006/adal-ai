import { useLayoutEffect, type FormEvent, type KeyboardEvent, type RefObject } from 'react'
import { useI18n } from '../i18n/context'
import { SendIcon } from './Icons'

interface ComposerProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  busy: boolean
  disabled: boolean
  maxChars: number
  inputRef: RefObject<HTMLTextAreaElement | null>
}

/** Поле ввода. Пока ИИ отвечает, писать можно, но отправить нельзя. */
export function Composer({ value, onChange, onSubmit, busy, disabled, maxChars, inputRef }: ComposerProps) {
  const { t } = useI18n()
  const length = value.trim().length
  const tooLong = length > maxChars
  const canSend = !busy && !disabled && length > 0 && !tooLong

  // Высота поля подстраивается под текст; верхний предел задан в CSS (max-height).
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value, inputRef])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (canSend) onSubmit()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      if (canSend) onSubmit()
    }
  }

  const showCounter = length > maxChars * 0.8

  return (
    <form className="composer" onSubmit={submit}>
      <label htmlFor="composer-input" className="composer__label">
        {t.inputLabel}
      </label>
      <div className="composer__row">
        <textarea
          id="composer-input"
          ref={inputRef}
          className="composer__input"
          rows={1}
          value={value}
          placeholder={t.inputPlaceholder}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          aria-invalid={tooLong || undefined}
          aria-describedby="composer-hint"
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
      <div className="composer__meta" id="composer-hint">
        {tooLong ? (
          <span className="composer__error">{t.tooLong(maxChars)}</span>
        ) : (
          <span className="composer__hint">{t.inputHint}</span>
        )}
        {showCounter && (
          <span className={tooLong ? 'composer__counter composer__counter--over' : 'composer__counter'}>
            {length} / {maxChars}
          </span>
        )}
      </div>
      <p className="composer__privacy">{t.privacyNote}</p>
    </form>
  )
}
