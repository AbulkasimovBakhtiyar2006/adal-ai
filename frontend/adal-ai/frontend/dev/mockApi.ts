/**
 * Dev mock API для разработки интерфейса без backend.
 *
 * Работает только внутри dev/preview-сервера Vite (см. vite.config.ts) и в сборку
 * не попадает. Реализует контракт /api/* из docs/ARCHITECTURE.md §4.4 и всегда
 * возвращает ai_mode = "mock". Ответы детерминированы и не содержат правовых сведений.
 *
 * Тестовые метки в тексте вопроса (docs/AI_CONTRACT.md §8):
 *   #clarify   — status = needs_clarification
 *   #noinfo    — status = insufficient_information
 *   #nostatus  — ответ без поля status
 *   #sources   — тестовые источники (со ссылкой и без)
 *   #markdown  — Markdown с опасными элементами для проверки безопасного вывода
 *   #error     — техническая ошибка AI_FAILED
 *   #timeout   — задержка и ошибка AI_TIMEOUT
 *   #ratelimit — ошибка RATE_LIMITED
 *   #flaky     — первая попытка AI_FAILED, повтор с тем же client_id успешен
 */
import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

const MAX_MESSAGE_CHARS = 2000
const MAX_BODY_BYTES = 16 * 1024
const SESSION_COOKIE = 'adal_sid'

type Lang = 'ru' | 'kk'
type Status = 'answered' | 'needs_clarification' | 'insufficient_information'

interface Source {
  title: string
  url: string | null
  details?: string | null
}

interface Reply {
  answer: string
  sources: Source[]
  status: Status | null
  ai_mode: 'mock'
}

interface Turn {
  id: string
  question: string
  reply: Reply
  conversationId: string
}

interface Session {
  turns: Turn[]
  conversations: Array<{ id: string; title: string; updated_at: number }>
  busy: boolean
  failedOnce: Set<string>
}

const sessions = new Map<string, Session>()

class MockError extends Error {
  readonly httpStatus: number
  readonly code: string
  readonly retryAfter: number | null

  constructor(httpStatus: number, code: string, retryAfter: number | null = null) {
    super(code)
    this.httpStatus = httpStatus
    this.code = code
    this.retryAfter = retryAfter
  }
}

const TEXT = {
  ru: {
    prefix: '**Тестовый ответ.** ИИ-модуль пока не подключён, это не сведения из базы знаний.',
    received: (q: string) => `Получен вопрос: «${q}».`,
    clarify: 'Тестовый уточняющий вопрос. Уточните, пожалуйста, какой документ или тема вас интересует?',
    noinfo: 'Тестовый ответ: так выглядит ситуация, когда в базе знаний нет подтверждённой информации.',
    sourcesIntro: 'Ниже показано, как выглядят источники. Это не настоящие документы.',
    testSourceUrl: 'Тестовый источник со ссылкой (не настоящий)',
    testSourceNoUrl: 'Тестовый источник без публичной ссылки (не настоящий)',
    testDetails: 'Тестовые реквизиты: раздел 1',
  },
  kk: {
    prefix: '**Сынақ жауабы.** ЖИ модулі әлі қосылмаған, бұл білім базасындағы мәлімет емес.',
    received: (q: string) => `Сұрақ қабылданды: «${q}».`,
    clarify: 'Сынақ нақтылау сұрағы. Қай құжат немесе тақырып қызықтыратынын нақтылаңызшы?',
    noinfo: 'Сынақ жауабы: білім базасында расталған ақпарат болмағанда жауап осылай көрінеді.',
    sourcesIntro: 'Төменде дереккөздердің қалай көрінетіні көрсетілген. Бұл нақты құжаттар емес.',
    testSourceUrl: 'Сілтемесі бар сынақ дереккөзі (нақты емес)',
    testSourceNoUrl: 'Жария сілтемесі жоқ сынақ дереккөзі (нақты емес)',
    testDetails: 'Сынақ деректемелері: 1-бөлім',
  },
} as const

const MARKDOWN_SAMPLE = [
  '**Проверка безопасного Markdown**',
  '',
  '- пункт списка с *курсивом*',
  '- `код` в строке',
  '',
  '| Колонка | Значение |',
  '|---|---|',
  '| A | 1 |',
  '',
  '<script>alert("xss")</script>',
  'Текст <b>не должен стать жирным</b> из-за HTML-тега.',
  '',
  '[Обычная ссылка](https://example.org/)',
  '[Опасная ссылка](javascript:alert(1))',
  '',
  '![Картинка не должна загружаться](https://example.org/tracking.png)',
].join('\n')

function buildReply(question: string, lang: Lang): Reply {
  const t = TEXT[lang]
  const short = question.length > 200 ? `${question.slice(0, 200)}…` : question
  const base = { sources: [] as Source[], ai_mode: 'mock' as const }

  if (question.includes('#clarify')) return { ...base, answer: t.clarify, status: 'needs_clarification' }
  if (question.includes('#noinfo')) return { ...base, answer: t.noinfo, status: 'insufficient_information' }
  if (question.includes('#markdown')) return { ...base, answer: MARKDOWN_SAMPLE, status: 'answered' }
  if (question.includes('#sources')) {
    return {
      ...base,
      answer: `${t.prefix}\n\n${t.sourcesIntro}`,
      status: 'answered',
      sources: [
        { title: t.testSourceUrl, url: 'https://example.org/', details: null },
        { title: t.testSourceNoUrl, url: null, details: t.testDetails },
      ],
    }
  }
  const answer = `${t.prefix}\n\n${t.received(short)}`
  if (question.includes('#nostatus')) return { ...base, answer, status: null }
  return { ...base, answer, status: 'answered' }
}

function getSession(req: IncomingMessage, res: ServerResponse): Session {
  const cookies = Object.fromEntries(
    (req.headers.cookie ?? '')
      .split(';')
      .map((part) => part.trim().split('='))
      .filter((pair) => pair.length === 2),
  )
  let sid = cookies[SESSION_COOKIE]
  if (!sid || !sessions.has(sid)) {
    sid = randomBytes(32).toString('base64url')
    sessions.set(sid, { turns: [], conversations: [], busy: false, failedOnce: new Set() })
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${sid}; HttpOnly; SameSite=Lax; Path=/api`)
  }
  return sessions.get(sid)!
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

function sendError(res: ServerResponse, err: MockError): void {
  if (err.retryAfter !== null) res.setHeader('Retry-After', String(err.retryAfter))
  sendJson(res, err.httpStatus, { error: { code: err.code, retry_after: err.retryAfter } })
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY_BYTES) throw new MockError(413, 'MESSAGE_TOO_LONG')
    chunks.push(chunk as Buffer)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
  } catch {
    // ниже — общий ответ о некорректном запросе
  }
  throw new MockError(400, 'MESSAGE_EMPTY')
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function handleChat(req: IncomingMessage, res: ServerResponse, session: Session): Promise<void> {
  const body = await readJson(req)
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  const lang: Lang = body.lang === 'kk' ? 'kk' : 'ru'
  const clientId = typeof body.client_id === 'string' && body.client_id.length <= 64 ? body.client_id : null
  const conversationId = typeof body.conversation_id === 'string' ? body.conversation_id : 'default'
  let conversation = session.conversations.find(item => item.id === conversationId)
  if (!conversation && conversationId !== 'default' && !body.local_only) throw new MockError(404, 'INTERNAL')
  if (!conversation) {
    conversation = { id: conversationId, title: '', updated_at: Date.now() / 1000 }
    if (!body.local_only) session.conversations.push(conversation)
  }

  if (!message) throw new MockError(422, 'MESSAGE_EMPTY')
  if (message.length > MAX_MESSAGE_CHARS) throw new MockError(422, 'MESSAGE_TOO_LONG')

  // Повтор с тем же client_id не создаёт второй вопрос в истории.
  const existing = clientId ? session.turns.find((turn) => turn.id === clientId) : undefined
  if (existing) {
    if (existing.conversationId !== conversationId || existing.question !== message) throw new MockError(409, 'AI_BAD_RESPONSE')
    return sendJson(res, 200, existing.reply)
  }

  if (session.busy) throw new MockError(409, 'CONVERSATION_BUSY')
  session.busy = true
  try {
    await delay(700)
    if (message.includes('#ratelimit')) throw new MockError(429, 'RATE_LIMITED', 30)
    if (message.includes('#error')) throw new MockError(502, 'AI_FAILED')
    if (message.includes('#timeout')) {
      await delay(2500)
      throw new MockError(504, 'AI_TIMEOUT')
    }
    if (message.includes('#flaky') && clientId && !session.failedOnce.has(clientId)) {
      session.failedOnce.add(clientId)
      throw new MockError(502, 'AI_FAILED')
    }
    const reply = buildReply(message, lang)
    // Как и настоящий backend: пара «вопрос — ответ» сохраняется только при успехе.
    if (!body.local_only) session.turns.push({ id: clientId ?? randomBytes(8).toString('hex'), question: message, reply, conversationId })
    conversation.title ||= message.slice(0, 100)
    conversation.updated_at = Date.now() / 1000
    sendJson(res, 200, reply)
  } finally {
    session.busy = false
  }
}

export function mockApiMiddleware() {
  return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    const path = (req.url ?? '/').split('?')[0]
    if (!path.startsWith('/api/')) return next()

    const session = getSession(req, res)
    const route = `${req.method} ${path}`

    const run = async (): Promise<void> => {
      switch (route) {
        case 'GET /api/conversations':
          return sendJson(res, 200, { conversations: [...session.conversations].sort((a,b) => b.updated_at - a.updated_at) })
        case 'POST /api/conversations': {
          if (session.busy) throw new MockError(409, 'CONVERSATION_BUSY')
          const item = { id: randomBytes(18).toString('base64url'), title: '', updated_at: Date.now() / 1000 }
          session.conversations.push(item)
          return sendJson(res, 200, item)
        }
        case 'GET /api/config':
          return sendJson(res, 200, { ai_mode: 'mock', max_message_chars: MAX_MESSAGE_CHARS, guest_local: true, user: null, google_client_id: null })
        case 'GET /api/history':
          return sendJson(res, 200, {
            turns: session.turns.filter(turn => turn.conversationId === (new URL(req.url ?? '/', 'http://localhost').searchParams.get('conversation_id') ?? 'default'))
              .map((turn) => ({ id: turn.id, question: turn.question, ...turn.reply })),
          })
        case 'POST /api/chat':
          return handleChat(req, res, session)
        case 'DELETE /api/history':
          session.turns = []
          res.statusCode = 204
          return void res.end()
        case 'DELETE /api/session':
          for (const [sid, value] of sessions) if (value === session) sessions.delete(sid)
          res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/api; Max-Age=0`)
          res.statusCode = 204
          return void res.end()
        default:
          return sendJson(res, 404, { error: { code: 'NOT_FOUND', retry_after: null } })
      }
    }

    run().catch((err: unknown) => {
      if (err instanceof MockError) return sendError(res, err)
      sendError(res, new MockError(500, 'INTERNAL'))
    })
  }
}
