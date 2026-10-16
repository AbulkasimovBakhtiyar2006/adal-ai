import type { ReactNode } from 'react'
import type { ChatReply, ErrorCode } from '../api/types'
import type { Turn } from '../chat/reducer'
import { useI18n } from '../i18n/context'
import { AlertIcon, InfoIcon, QuestionIcon, RetryIcon } from './Icons'
import { SafeMarkdown } from './SafeMarkdown'
import { Sources } from './Sources'

interface TurnViewProps {
  turn: Turn
  canRetry: boolean
  onRetry: (id: string) => void
}

/** Вопрос пользователя и одно из состояний ответа: ожидание, ответ или техническая ошибка. */
export function TurnView({ turn, canRetry, onRetry }: TurnViewProps) {
  const { t } = useI18n()
  return (
    <li className="turn">
      <div className="bubble bubble--user">
        <span className="visually-hidden">{t.you}: </span>
        {turn.question}
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
      {turn.phase === 'done' && turn.reply && <Answer reply={turn.reply} />}
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

function Answer({ reply }: { reply: ChatReply }) {
  const { t } = useI18n()
  const status = reply.status ?? 'answered'
  return (
    <article className={`answer answer--${status}`}>
      <header className="answer__header">
        <span className="answer__author">{t.appName}</span>
      </header>
      {status === 'needs_clarification' && (
        <StateNote icon={<QuestionIcon />} title={t.statusClarification} hint={t.statusClarificationHint} />
      )}
      {status === 'insufficient_information' && (
        <StateNote icon={<InfoIcon />} title={t.statusInsufficient} hint={t.statusInsufficientHint} />
      )}
      <SafeMarkdown text={reply.answer} />
      <Sources sources={reply.sources} />
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
