/** Типы web API. Контракт описан в docs/ARCHITECTURE.md §4.4. */

export type Lang = 'ru' | 'kk'
export type AiMode = 'mock' | 'real'
export type AnswerStatus = 'answered' | 'needs_clarification' | 'insufficient_information'

export interface Source {
  title: string
  /** Только абсолютный http(s)-адрес или null, если у документа нет публичной ссылки. */
  url: string | null
  /** Реквизиты или раздел документа — ровно как переданы из базы знаний. */
  details: string | null
}

export interface ChatReply {
  answer: string
  sources: Source[]
  /** null — ИИ-модуль не передал статус; характер ответа не угадывается. */
  status: AnswerStatus | null
  aiMode: AiMode | null
}

export interface HistoryTurn {
  id: string
  question: string
  reply: ChatReply
}

export interface PublicConfig {
  aiMode: AiMode
  maxMessageChars: number
}

export const ERROR_CODES = [
  'MESSAGE_EMPTY',
  'MESSAGE_TOO_LONG',
  'RATE_LIMITED',
  'CONVERSATION_BUSY',
  'AI_NOT_CONFIGURED',
  'AI_TIMEOUT',
  'AI_FAILED',
  'AI_BAD_RESPONSE',
  'INTERNAL',
  'NETWORK',
  'CLIENT_TIMEOUT',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]
