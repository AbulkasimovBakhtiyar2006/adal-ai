import { useEffect, useRef } from 'react'
import { useI18n } from '../i18n/context'
import type { VoiceController, VoiceState } from '../voice/VoiceController'
import { MicIcon, PhoneIcon } from './Icons'

interface Props {
  controller: VoiceController
  state: VoiceState
  onClose: () => void
  onQuestion: (question: string) => Promise<string | undefined>
  busy: boolean
}

export function VoiceCall({ controller, state, onClose, onQuestion, busy }: Props) {
  const { t } = useI18n()
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => { dialog?.close(); controller.end(); previous?.focus() }
  }, [controller])
  const error = state.error ?? controller.unavailable
  return <dialog ref={dialogRef} className="voice-dialog" aria-labelledby="voice-title"
    onCancel={event => { event.preventDefault(); onClose() }}>
    <div className="voice-call">
      <div className="voice-call__top"><span>{t.appName}</span><button className="btn btn--ghost" onClick={onClose} aria-label={t.voice.close}>✕</button></div>
      <div className={`voice-orb voice-orb--${state.phase}`} aria-hidden="true"><MicIcon /><div className="voice-wave">{Array.from({ length: 7 }, (_, i) => <i key={i} />)}</div></div>
      <h2 id="voice-title">{t.voice.title}</h2>
      <p className="voice-call__status" role="status">{state.active ? t.voice.phases[state.phase] : t.voice.ready}</p>
      <p className="voice-call__hint">{state.active ? t.voice.turnHint : t.voice.intro}</p>
      {state.transcript && <div className="voice-transcript"><span>{t.you}</span><p>{state.transcript}</p></div>}
      {error && <p className="voice-error" role="alert">{t.voice.errors[error]}</p>}
      <div className="voice-call__actions">
        {!state.active ? <button className="btn btn--primary" disabled={busy || !!controller.unavailable} onClick={() => controller.start(onQuestion)}><PhoneIcon />{t.voice.start}</button> : <>
          <button className="btn btn--secondary" onClick={controller.toggleMute} aria-pressed={state.muted}><MicIcon />{state.muted ? t.voice.unmute : t.voice.mute}</button>
          {(state.phase === 'paused' || state.phase === 'speaking') && <button className="btn btn--secondary" onClick={controller.resume}>{state.phase === 'speaking' ? t.voice.interrupt : t.voice.resume}</button>}
          <button className="btn btn--danger" onClick={onClose}><PhoneIcon />{t.voice.end}</button>
        </>}
      </div>
      <p className="voice-call__privacy">{t.voice.privacy}</p>
    </div>
  </dialog>
}
