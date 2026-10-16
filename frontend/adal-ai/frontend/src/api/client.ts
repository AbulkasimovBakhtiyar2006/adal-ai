/**
 * Клиент web API. Ключей и секретов здесь нет и быть не должно: браузер общается
 * только с нашим сервером, а сессия передаётся HttpOnly-cookie.
 *
 * Ответы сервера считаются недоверенными: каждый ответ проверяется и нормализуется.
 */
import {
  ERROR_CODES,
  type AiMode,
  type AnswerStatus,
  type ChatReply,
  type Conversation,
  type ErrorCode,
  type HistoryTurn,
  type Lang,
  type PublicConfig,
  type Source,
} from './types'

/** Сервер ждёт ИИ не дольше AI_TIMEOUT_SECONDS; клиент ждёт чуть дольше. */
const CHAT_TIMEOUT_MS = 120_000
const DEFAULT_TIMEOUT_MS = 15_000
const MAX_SOURCES = 20
const MAX_TITLE_CHARS = 300

export class ApiError extends Error {
  readonly code: ErrorCode
  readonly retryAfter: number | null

  constructor(code: ErrorCode, retryAfter: number | null = null) {
    super(code)
    this.name = 'ApiError'
    this.code = code
    this.retryAfter = retryAfter
  }
}

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value)
}

async function request(method: string, path: string, body?: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
  } catch {
    throw new ApiError(controller.signal.aborted ? 'CLIENT_TIMEOUT' : 'NETWORK')
  } finally {
    clearTimeout(timer)
  }

  if (response.status === 204) return null

  let data: unknown = null
  try {
    data = await response.json()
  } catch {
    // тело не JSON — ниже обрабатывается как внутренняя ошибка
  }

  if (!response.ok) {
    const error = (data as { error?: { code?: unknown; retry_after?: unknown } } | null)?.error
    const retryAfter = typeof error?.retry_after === 'number' ? error.retry_after : null
    throw new ApiError(isErrorCode(error?.code) ? error.code : 'INTERNAL', retryAfter)
  }
  if (data === null) throw new ApiError('INTERNAL')
  return data
}

/** Возвращает адрес, только если это абсолютный http(s) URL. Иначе — null. */
export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

function normalizeSources(value: unknown): Source[] {
  if (!Array.isArray(value)) return []
  const result: Source[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, MAX_TITLE_CHARS) : ''
    if (!title) continue
    const details = typeof raw.details === 'string' && raw.details.trim() ? raw.details.trim() : null
    result.push({ title, url: safeHttpUrl(raw.url), details })
    if (result.length === MAX_SOURCES) break
  }
  return result
}

const STATUSES: readonly AnswerStatus[] = ['answered', 'needs_clarification', 'insufficient_information']

export function normalizeReply(value: unknown): ChatReply {
  const raw = (value ?? {}) as Record<string, unknown>
  if (typeof raw.answer !== 'string' || !raw.answer.trim()) throw new ApiError('AI_BAD_RESPONSE')
  return {
    answer: raw.answer,
    sources: normalizeSources(raw.sources),
    status: STATUSES.includes(raw.status as AnswerStatus) ? (raw.status as AnswerStatus) : null,
    aiMode: raw.ai_mode === 'mock' || raw.ai_mode === 'real' ? (raw.ai_mode as AiMode) : null,
  }
}

export async function getConfig(): Promise<PublicConfig> {
  const raw = (await request('GET', '/api/config')) as Record<string, unknown>
  const aiMode = raw.ai_mode
  if (aiMode !== 'mock' && aiMode !== 'real') throw new ApiError('INTERNAL')
  const max = typeof raw.max_message_chars === 'number' && raw.max_message_chars > 0 ? raw.max_message_chars : 2000
  return { aiMode, maxMessageChars: max }
}

export async function getHistory(conversationId?: string): Promise<HistoryTurn[]> {
  const path = conversationId ? `/api/history?conversation_id=${encodeURIComponent(conversationId)}` : '/api/history'
  const raw = (await request('GET', path)) as { turns?: unknown }
  if (!Array.isArray(raw.turns)) return []
  const turns: HistoryTurn[] = []
  for (const item of raw.turns) {
    const turn = (item ?? {}) as Record<string, unknown>
    if (typeof turn.id !== 'string' || typeof turn.question !== 'string') continue
    try {
      turns.push({ id: turn.id, question: turn.question, reply: normalizeReply(turn) })
    } catch {
      // повреждённую запись истории пропускаем, остальные показываем
    }
  }
  return turns
}

/** clientId делает отправку идемпотентной: повтор не создаёт второй вопрос на сервере. */
export async function sendMessage(message: string, lang: Lang, clientId: string, conversationId?: string): Promise<ChatReply> {
  const raw = await request('POST', '/api/chat', { message, lang, client_id: clientId, conversation_id: conversationId }, CHAT_TIMEOUT_MS)
  return normalizeReply(raw)
}

function normalizeConversation(value: unknown): Conversation {
  const raw = (value ?? {}) as Record<string, unknown>
  if (typeof raw.id !== 'string' || typeof raw.title !== 'string' || typeof raw.updated_at !== 'number') throw new ApiError('INTERNAL')
  return { id: raw.id, title: raw.title, updatedAt: raw.updated_at }
}

export async function getConversations(): Promise<Conversation[]> {
  const raw = await request('GET', '/api/conversations') as { conversations?: unknown }
  if (!Array.isArray(raw.conversations)) throw new ApiError('INTERNAL')
  return raw.conversations.map(normalizeConversation)
}

export async function createConversation(): Promise<Conversation> {
  return normalizeConversation(await request('POST', '/api/conversations'))
}

/** Новый диалог: сервер удаляет сообщения текущего разговора. */
export async function clearHistory(): Promise<void> {
  await request('DELETE', '/api/history')
}

/** Удалить мои данные: сервер удаляет историю и саму сессию. */
export async function deleteSession(): Promise<void> {
  await request('DELETE', '/api/session')
}
