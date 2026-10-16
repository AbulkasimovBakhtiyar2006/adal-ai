import { localHistory } from '../chat/localHistory'
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
  type ChatAttachment,
  type Conversation,
  type ErrorCode,
  type HistoryTurn,
  type Lang,
  type PublicConfig,
  type ResponseMode,
  type Source,
} from './types'

/** Сервер ждёт ИИ не дольше AI_TIMEOUT_SECONDS; клиент ждёт чуть дольше. */
const CHAT_TIMEOUT_MS = 120_000
const DEFAULT_TIMEOUT_MS = 15_000
let localGuest = false
let accountId: string | undefined
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
      headers: { ...(body === undefined || body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(accountId && path !== '/api/config' ? { 'X-Adal-Account': accountId } : {}) },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      signal: controller.signal,
    })
  } catch {
    throw new ApiError(controller.signal.aborted ? 'CLIENT_TIMEOUT' : 'NETWORK')
  } finally {
    clearTimeout(timer)
  }

  if (response.status === 401 && accountId) throw new ApiError('SESSION_CHANGED')
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
    ...(typeof raw.search_suggestions_url === 'string' &&
      /^\/api\/search-suggestions\/[a-zA-Z0-9_-]{1,100}$/.test(raw.search_suggestions_url)
      ? { searchSuggestionsUrl: raw.search_suggestions_url } : {}),
    answer: raw.answer,
    ...(raw.response_language === 'kk' || raw.response_language === 'ru'
      ? { responseLanguage: raw.response_language } : {}),
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
  const user = raw.user && typeof raw.user === 'object' ? raw.user as Record<string, unknown> : null
  if (user && (typeof user.id !== 'string' || typeof user.name !== 'string' || typeof user.email !== 'string')) throw new ApiError('INTERNAL')
  accountId = user ? String(user.id) : undefined
  localGuest = raw.guest_local === true && !user
  return { aiMode, maxMessageChars: max,
    speechLanguages: Array.isArray(raw.speech_languages) ? raw.speech_languages.filter((lang): lang is Lang => lang === 'ru' || lang === 'kk') : [],
    user: user ? { id: String(user.id), name: String(user.name), email: String(user.email) } : null,
    guestLocal: raw.guest_local === true,
    googleClientId: typeof raw.google_client_id === 'string' ? raw.google_client_id : null,
    googleNonce: typeof raw.google_nonce === 'string' ? raw.google_nonce : null,
  }
}

export async function synthesizeSpeech(text: string, lang: Lang, signal: AbortSignal): Promise<Blob> {
  const response = await fetch('/api/speech', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(accountId ? { 'X-Adal-Account': accountId } : {}) },
    body: JSON.stringify({ text, lang }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(25_000)]),
  })
  if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/')) throw new Error('speech_failed')
  const audio = await response.blob()
  if (!audio.size) throw new Error('empty_speech')
  return audio
}

export async function getHistory(conversationId?: string): Promise<HistoryTurn[]> {
  if (localGuest) return local(() => localHistory.history(conversationId))
  const path = conversationId ? `/api/history?conversation_id=${encodeURIComponent(conversationId)}` : '/api/history'
  const raw = (await request('GET', path)) as { turns?: unknown }
  if (!Array.isArray(raw.turns)) return []
  const turns: HistoryTurn[] = []
  for (const item of raw.turns) {
    const turn = (item ?? {}) as Record<string, unknown>
    if (typeof turn.id !== 'string' || typeof turn.question !== 'string') continue
    try {
      turns.push({ id: turn.id, question: turn.question, attachments: normalizeAttachments(turn.attachments), reply: normalizeReply(turn) })
    } catch {
      // повреждённую запись истории пропускаем, остальные показываем
    }
  }
  return turns
}

/** clientId делает отправку идемпотентной: повтор не создаёт второй вопрос на сервере. */
export async function sendMessage(message: string, lang: Lang, clientId: string, conversationId?: string, responseMode: ResponseMode = 'text', attachments: ChatAttachment[] = []): Promise<ChatReply> {
  const guest = localGuest
  const previous = guest ? local(() => localHistory.history(conversationId)) : []
  const existing = previous.find(turn => turn.id === clientId)
  if (existing) return existing.reply
  const raw = await request('POST', '/api/chat', { message, lang, client_id: clientId, conversation_id: conversationId, response_mode: responseMode, ...(attachments.length ? { attachments } : {}),
    ...(guest ? { local_only: true, context: previous.slice(-20).map(turn => ({ question: turn.question, answer: turn.reply.answer.slice(0, 20000), ...(turn.attachments?.length ? { attachments: turn.attachments } : {}) })) } : {}),
  }, CHAT_TIMEOUT_MS)
  const reply = normalizeReply(raw)
  if (guest && conversationId) local(() => localHistory.save(conversationId, { id: clientId, question: message, attachments, reply }))
  return reply
}

function normalizeConversation(value: unknown): Conversation {
  const raw = (value ?? {}) as Record<string, unknown>
  if (typeof raw.id !== 'string' || typeof raw.title !== 'string' || typeof raw.updated_at !== 'number') throw new ApiError('INTERNAL')
  return { id: raw.id, title: raw.title, updatedAt: raw.updated_at }
}

export async function getConversations(): Promise<Conversation[]> {
  if (localGuest) return local(localHistory.list)
  const raw = await request('GET', '/api/conversations') as { conversations?: unknown }
  if (!Array.isArray(raw.conversations)) throw new ApiError('INTERNAL')
  return raw.conversations.map(normalizeConversation)
}

export async function createConversation(): Promise<Conversation> {
  if (localGuest) return local(localHistory.create)
  return normalizeConversation(await request('POST', '/api/conversations'))
}

/** Новый диалог: сервер удаляет сообщения текущего разговора. */
export async function clearHistory(): Promise<void> {
  if (localGuest) { local(localHistory.clear); return }
  await request('DELETE', '/api/history')
}

/** Удалить мои данные: сервер удаляет историю и саму сессию. */
export async function deleteSession(): Promise<void> {
  if (localGuest) { local(localHistory.clear); return }
  await request('DELETE', '/api/session')
}

function local<T>(operation: () => T): T {
  try { return operation() } catch { throw new ApiError('LOCAL_STORAGE') }
}

export async function signInWithGoogle(credential: string): Promise<void> {
  await request('POST', '/api/auth/google', { credential })
}
export async function signOut(): Promise<void> {
  await request('POST', '/api/auth/logout', {})
}

function normalizeAttachments(value: unknown): ChatAttachment[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is ChatAttachment => !!item && typeof item.name === 'string' && typeof item.text === 'string' && typeof item.size === 'number').slice(0, 3)
}

export async function uploadChatFile(file: File): Promise<ChatAttachment> {
  const form = new FormData()
  form.append('file', file)
  const raw = await request('POST', '/api/chat/files', form, CHAT_TIMEOUT_MS)
  const attachment = normalizeAttachments([raw])[0]
  if (!attachment) throw new ApiError('FILE_UNREADABLE')
  return attachment
}

export interface KnowledgeDocument { id: string; kind: 'adilet' | 'akorda' | 'uploaded'; title: string; language: string; url: string; status: 'indexed' | 'downloaded' | 'source'; verified_at?: string }
export interface KnowledgeBase {
  mode: 'deepseek' | 'verified'
  web_search: boolean
  models: string[]
  sites: { host: string; title: string; url: string }[]
  topics: { id: string; title: string; urls: string[] }[]
  documents: KnowledgeDocument[]
}

const text = (value: unknown) => typeof value === 'string' ? value.slice(0, MAX_TITLE_CHARS) : ''

/** Публичный список источников, на которые опирается ассистент. Ссылки без http(s) отбрасываются. */
export async function getKnowledge(): Promise<KnowledgeBase> {
  const raw = await request('GET', '/api/knowledge') as Partial<Record<keyof KnowledgeBase, unknown>>
  const list = (value: unknown) => Array.isArray(value) ? value as Record<string, unknown>[] : []
  return {
    mode: raw.mode === 'verified' ? 'verified' : 'deepseek',
    web_search: raw.web_search === true,
    models: list(raw.models).map(text).filter(Boolean),
    sites: list(raw.sites).flatMap(site => { const url = safeHttpUrl(site.url); return url ? [{ host: text(site.host), title: text(site.title), url }] : [] }),
    topics: list(raw.topics).map(topic => ({ id: text(topic.id), title: text(topic.title), urls: list(topic.urls).map(safeHttpUrl).filter((url): url is string => !!url) })),
    documents: list(raw.documents).flatMap(doc => {
      const url = safeHttpUrl(doc.url)
      if (!url) return []
      const kind = doc.kind === 'adilet' || doc.kind === 'akorda' ? doc.kind : 'uploaded'
      const status = doc.status === 'indexed' || doc.status === 'downloaded' ? doc.status : 'source'
      return [{ id: text(doc.id), kind, title: text(doc.title), language: text(doc.language), url, status, verified_at: typeof doc.verified_at === 'string' ? doc.verified_at : undefined }]
    }),
  }
}
