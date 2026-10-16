import type { ReactNode } from 'react'
import type { ChatReply, ErrorCode } from '../api/types'
import type { Turn } from '../chat/reducer'
import { useI18n } from '../i18n/context'
import { AlertIcon, InfoIcon, QuestionIcon, RetryIcon, SpeakerIcon } from './Icons'
import { SafeMarkdown } from './SafeMarkdown'
import { Sources } from './Sources'

interface TurnViewProps {
  turn: Turn
  canRetry: boolean
  onRetry: (id: string) => void
  canSpeak?: boolean
  speaking?: boolean
  onSpeak?: () => void
}

/** Вопрос пользователя и одно из состояний ответа: ожидание, ответ или техническая ошибка. */
export function TurnView({ turn, canRetry, onRetry, canSpeak, speaking, onSpeak }: TurnViewProps) {
  const { t } = useI18n()
  return (
    <li className="turn">
      <div className="bubble bubble--user">
        <span className="visually-hidden">{t.you}: </span>
        {turn.question}
        {!!turn.attachments?.length && <ul className="message-files" aria-label={t.files.attached}>
          {turn.attachments.map((file, index) => <li key={index}>📎 {file.name}</li>)}
        </ul>}
      </div>
      {turn.phase === 'pending' && (
        <div className="answer answer--pending" role="status">
          <span className="typing" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          {t.waiting}
        </div>
      )}
      {turn.phase === 'done' && turn.reply && <Answer reply={turn.reply} canSpeak={canSpeak} speaking={speaking} onSpeak={onSpeak} />}
      {turn.phase === 'error' && turn.error && (
        <TechnicalError
          code={turn.error.code}
          retryAfter={turn.error.retryAfter}
          onRetry={canRetry ? () => onRetry(turn.id) : null}
        />
      )}
    </li>
  )
}

function Answer({ reply, canSpeak, speaking, onSpeak }: { reply: ChatReply } & Pick<TurnViewProps, 'canSpeak' | 'speaking' | 'onSpeak'>) {
  const { t } = useI18n()
  const status = reply.status ?? 'answered'
  return (
    <article className={`answer answer--${status}`}>
      <header className="answer__header">
        <span className="answer__author">{t.appName}</span>
        {canSpeak && <button className="btn btn--ghost answer__listen" onClick={onSpeak} aria-pressed={!!speaking}><SpeakerIcon />{speaking ? t.voice.stop : t.voice.listen}</button>}
      </header>
      {status === 'needs_clarification' && (
        <StateNote icon={<QuestionIcon />} title={t.statusClarification} hint={t.statusClarificationHint} />
      )}
      {status === 'insufficient_information' && (
        <StateNote icon={<InfoIcon />} title={t.statusInsufficient} hint={t.statusInsufficientHint} />
      )}
      <SafeMarkdown text={reply.answer} />
      <Sources sources={reply.sources} />
      {reply.searchSuggestionsUrl && (
        <iframe
          title="Google Search"
          src={reply.searchSuggestionsUrl}
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          width="100%"
          height="100"
          className="search-suggestions"
        />
      )}
    </article>
  )
}

function StateNote({ icon, title, hint }: { icon: ReactNode; title: string; hint: string }) {
  return (
    <div className="state-note">
      {icon}
      <div>
        <p className="state-note__title">{title}</p>
        <p className="state-note__hint">{hint}</p>
      </div>
    </div>
  )
}

interface TechnicalErrorProps {
  code: ErrorCode
  retryAfter: number | null
  onRetry: (() => void) | null
}

function TechnicalError({ code, retryAfter, onRetry }: TechnicalErrorProps) {
  const { t } = useI18n()
  return (
    <div className="answer answer--error" role="alert">
      <StateNote icon={<AlertIcon />} title={t.errorTitle} hint={t.errors[code]} />
      {retryAfter !== null && <p className="answer__meta">{t.retryAfter(retryAfter)}</p>}
      <p className="answer__meta">{t.errorNote}</p>
      {onRetry && (
        <button type="button" className="btn btn--secondary" onClick={onRetry}>
          <RetryIcon />
          {t.retry}
        </button>
      )}
    </div>
  )
}
