import type { ChatAttachment, ChatReply, ErrorCode, HistoryTurn, ResponseMode } from '../api/types'

/**
 * Один «ход» диалога: вопрос пользователя и то, что с ним произошло.
 * id совпадает с client_id запроса, поэтому повтор отправляет тот же ход,
 * а не создаёт новый вопрос.
 */
export interface Turn {
  id: string
  question: string
  attachments?: ChatAttachment[]
  responseMode?: ResponseMode
  phase: 'pending' | 'done' | 'error'
  reply: ChatReply | null
  error: { code: ErrorCode; retryAfter: number | null } | null
}

export type ChatAction =
  | { type: 'historyLoaded'; turns: HistoryTurn[] }
  | { type: 'submitted'; id: string; question: string; responseMode?: ResponseMode; attachments?: ChatAttachment[] }
  | { type: 'retried'; id: string }
  | { type: 'succeeded'; id: string; reply: ChatReply }
  | { type: 'failed'; id: string; code: ErrorCode; retryAfter: number | null }
  | { type: 'cleared' }

export function chatReducer(turns: Turn[], action: ChatAction): Turn[] {
  switch (action.type) {
    case 'historyLoaded':
      return action.turns.map((turn) => ({ ...turn, phase: 'done', error: null }))
    case 'submitted':
      // Неудачные ходы не сохранены на сервере. При новом вопросе они убираются,
      // чтобы экран совпадал с историей на сервере.
      return [
        ...turns.filter((turn) => turn.phase !== 'error'),
        { id: action.id, question: action.question, attachments: action.attachments, responseMode: action.responseMode, phase: 'pending', reply: null, error: null },
      ]
    case 'retried':
      return turns.map((turn) =>
        turn.id === action.id && turn.phase === 'error' ? { ...turn, phase: 'pending', error: null } : turn,
      )
    case 'succeeded':
      return turns.map((turn) =>
        turn.id === action.id ? { ...turn, phase: 'done', reply: action.reply, error: null } : turn,
      )
    case 'failed':
      return turns.map((turn) =>
        turn.id === action.id
          ? { ...turn, phase: 'error', error: { code: action.code, retryAfter: action.retryAfter } }
          : turn,
      )
    case 'cleared':
      return []
  }
}
