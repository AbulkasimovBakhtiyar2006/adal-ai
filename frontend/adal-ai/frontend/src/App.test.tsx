import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { LangProvider } from './i18n/LangProvider'
import type { Recognition } from './voice/VoiceController'

interface Call {
  method: string
  url: string
  body: Record<string, unknown> | undefined
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** Небольшой поддельный сервер для fetch. Ответы чата задаются по очереди. */
function fakeServer(chatResponses: Array<() => Response | Promise<Response>>) {
  const calls: Call[] = []
  const queue = [...chatResponses]
  const conversations: Array<{ id: string; title: string; updated_at: number }> = []
  const histories: Record<string, Array<Record<string, unknown>>> = {}
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
    calls.push({ method, url, body })
    if (url === '/api/config') return json(200, { ai_mode: 'mock', max_message_chars: 2000 })
    if (url === '/api/conversations' && method === 'GET') return json(200, { conversations })
    if (url === '/api/conversations' && method === 'POST') {
      const item = { id: `chat-${conversations.length + 1}`, title: '', updated_at: Date.now() / 1000 }
      conversations.unshift(item)
      histories[item.id] = []
      return json(200, item)
    }
    if (url.startsWith('/api/history')) {
      const id = new URL(url, 'https://local.test').searchParams.get('conversation_id') ?? 'default'
      return json(200, { turns: histories[id] ?? [] })
    }
    if (url === '/api/chat') {
      const response = await (queue.shift() ?? (() => json(500, {})))()
      if (response.ok && body) {
        const id = String(body.conversation_id)
        histories[id].push({ id: body.client_id, question: body.message, ...await response.clone().json() })
        const item = conversations.find(item => item.id === id)!
        item.title ||= String(body.message)
      }
      return response
    }
    if (method === 'DELETE') return new Response(null, { status: 204 })
    return json(404, { error: { code: 'NOT_FOUND' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { chatCalls: () => calls.filter((call) => call.url === '/api/chat'), calls }
}

const answer = (extra: Record<string, unknown> = {}) => () =>
  json(200, { answer: 'Тестовый ответ', sources: [], status: 'answered', ai_mode: 'mock', ...extra })

function renderApp() {
  return render(
    <LangProvider>
      <App />
    </LangProvider>,
  )
}

beforeEach(() => {
  document.documentElement.lang = 'ru'
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('App', () => {
  it('переносит вопрос с главной в чат для отправки', async () => {
    const server = fakeServer([])
    const user = userEvent.setup()
    renderApp()
    await user.type(await screen.findByLabelText('Вопрос ИИ-консультанту'), 'Что такое гражданское общество?')
    await user.click(screen.getByRole('button', { name: 'Задать вопрос' }))
    expect(await screen.findByLabelText('Ваш вопрос')).toHaveValue('Что такое гражданское общество?')
    expect(server.chatCalls()).toHaveLength(0)
  })

  it('выбирает тему документа и закрывает историю по Escape', async () => {
    fakeServer([])
    const user = userEvent.setup()
    renderApp()
    await user.click(await screen.findByRole('button', { name: 'История чатов' }))
    expect(screen.getByRole('button', { name: 'История чатов' })).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'История чатов' })).toHaveAttribute('aria-expanded', 'false')
    await user.click(await screen.findByRole('button', { name: 'Документы' }))
    await user.click(screen.getByRole('button', { name: /Конституция и законы:/ }))
    expect(await screen.findByLabelText('Ваш вопрос')).toHaveValue('Помоги разобраться в структуре Конституции Республики Казахстан.')
  })

  it('показывает главную страницу и примеры как подсказки', async () => {
    const server = fakeServer([])
    const user = userEvent.setup()
    renderApp()

    expect(await screen.findByRole('heading', { name: 'Разобраться в документах — проще.' })).toBeInTheDocument()
    expect(screen.getByText(/Не является официальным государственным органом/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Слышащее государство/ }))
    expect(await screen.findByLabelText('Ваш вопрос')).toHaveValue(
      'Объясни концепцию «Слышащее государство» по официальным источникам.',
    )
    expect(server.chatCalls()).toHaveLength(0)
  })

  it('показывает индикатор ожидания, затем уточняющий вопрос', async () => {
    let release: (response: Response) => void = () => {}
    fakeServer([() => new Promise<Response>((resolve) => (release = resolve))])
    const user = userEvent.setup()
    renderApp()
    await user.click(await screen.findByRole('button', { name: 'Перейти в чат' }))

    await user.type(await screen.findByLabelText('Ваш вопрос'), 'Расскажи про закон{Enter}')
    expect(await screen.findByText('ИИ готовит ответ…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled()

    release(json(200, { answer: 'Какой закон?', sources: [], status: 'needs_clarification', ai_mode: 'mock' }))
    expect(await screen.findByText('Нужно уточнение')).toBeInTheDocument()
    expect(screen.getByText('Какой закон?')).toBeInTheDocument()
    expect(screen.queryByText('Техническая ошибка')).toBeNull()
  })

  it('отличает «нет подтверждённой информации» от технической ошибки', async () => {
    fakeServer([answer({ answer: 'В базе нет данных.', status: 'insufficient_information' })])
    const user = userEvent.setup()
    renderApp()
    await user.click(await screen.findByRole('button', { name: 'Перейти в чат' }))

    await user.type(await screen.findByLabelText('Ваш вопрос'), 'Вопрос{Enter}')
    expect(await screen.findByText('Недостаточно подтверждённой информации')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('Техническая ошибка')).toBeNull()
  })

  it('повторяет вопрос после ошибки без дубликата', async () => {
    const server = fakeServer([() => json(502, { error: { code: 'AI_FAILED' } }), answer()])
    const user = userEvent.setup()
    renderApp()
    await user.click(await screen.findByRole('button', { name: 'Перейти в чат' }))

    await user.type(await screen.findByLabelText('Ваш вопрос'), 'Один вопрос{Enter}')
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Техническая ошибка')).toBeInTheDocument()
    expect(within(alert).getByText('Не удалось получить ответ от ИИ.')).toBeInTheDocument()

    await user.click(within(alert).getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByText('Тестовый ответ')).toBeInTheDocument()

    const [first, second] = server.chatCalls()
    expect(second.body?.client_id).toBe(first.body?.client_id)
    expect(screen.getAllByText('Тестовый ответ')).toHaveLength(1)
  })

  it('переключает язык интерфейса и передаёт его на сервер', async () => {
    const server = fakeServer([answer()])
    const user = userEvent.setup()
    renderApp()

    await screen.findByRole('heading', { name: 'Разобраться в документах — проще.' })
    await user.click(screen.getByRole('button', { name: 'KZ' }))

    expect(screen.getByRole('heading', { name: 'Құжаттарды түсіну оңайырақ.' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'KZ' })).toHaveAttribute('aria-pressed', 'true')
    expect(document.documentElement.lang).toBe('kk')

    await user.click(screen.getByRole('button', { name: 'Чатқа өту' }))
    await user.type(await screen.findByLabelText('Сіздің сұрағыңыз'), 'Сұрақ{Enter}')
    await screen.findByText('Тестовый ответ')
    expect(server.chatCalls()[0].body?.lang).toBe('kk')
  })

  it('сохраняет старый диалог и открывает его из истории после перезагрузки', async () => {
    const server = fakeServer([answer()])
    const user = userEvent.setup()
    const rendered = renderApp()
    await user.click(await screen.findByRole('button', { name: 'Перейти в чат' }))

    await user.type(await screen.findByLabelText('Ваш вопрос'), 'Вопрос{Enter}')
    await screen.findByText('Тестовый ответ')

    await user.click(screen.getByRole('button', { name: 'Новый диалог' }))
    await screen.findByRole('heading', { name: 'Что вы хотите узнать?' })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.queryByText('Тестовый ответ')).toBeNull()
    expect(server.calls.some(call => call.method === 'DELETE')).toBe(false)
    rendered.unmount()
    renderApp()
    await user.click(await screen.findByRole('button', { name: 'История чатов' }))
    await user.click(await screen.findByRole('button', { name: /Вопрос/ }))
    expect(await screen.findByText('Тестовый ответ')).toBeInTheDocument()
    expect(server.chatCalls()[0].body?.conversation_id).toBe('chat-1')
  })
})


describe('voice UI', () => {
  function dialogSupport() {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } })
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open') } })
  }
  it('opens a call, sends speech to the current chat, reads and preserves the answer', async () => {
    dialogSupport()
    const instances: Recognition[] = []
    class BrowserRecognition implements Recognition {
      lang = ''; continuous = false; interimResults = false
      onresult: Recognition['onresult'] = null
      onerror: Recognition['onerror'] = null
      onend: Recognition['onend'] = null
      start = vi.fn(); abort = vi.fn()
      constructor() { instances.push(this) }
    }
    const spoken: SpeechSynthesisUtterance[] = []
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('SpeechRecognition', BrowserRecognition)
    vi.stubGlobal('SpeechSynthesisUtterance', class { text: string; constructor(text: string) { this.text = text } })
    vi.stubGlobal('speechSynthesis', { getVoices: () => [{ lang: 'ru-RU' }], speak: (utterance: SpeechSynthesisUtterance) => spoken.push(utterance), cancel: vi.fn() })
    const server = fakeServer([answer()])
    const user = userEvent.setup()
    renderApp()
    await user.click(await screen.findByRole('button', { name: 'Перейти в чат' }))
    await user.click(screen.getByRole('button', { name: 'Звонок ИИ' }))
    expect(screen.getByRole('dialog', { name: 'Звонок ИИ' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Начать звонок' }))
    act(() => {
      instances[0].onresult?.({ results: [{ isFinal: true, 0: { transcript: 'Голосовой вопрос' } }] })
      instances[0].onend?.()
    })
    await waitFor(() => expect(spoken).toHaveLength(1))
    expect(server.chatCalls()[0].body).toMatchObject({ message: 'Голосовой вопрос', conversation_id: 'chat-1', lang: 'ru' })
    expect(spoken[0].text).toBe('Тестовый ответ')
    await user.click(screen.getByRole('button', { name: 'Завершить' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Тестовый ответ')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Слушать' }))
    expect(spoken).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Остановить' }))
    expect(screen.getByRole('button', { name: 'Слушать' })).toBeInTheDocument()
  })
  it('explains unavailable microphone support and keeps the text chat usable', async () => {
    dialogSupport()
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('SpeechRecognition', undefined)
    fakeServer([])
    const user = userEvent.setup()
    renderApp()
    await user.click(await screen.findByRole('button', { name: 'Перейти в чат' }))
    await user.click(screen.getByRole('button', { name: 'Звонок ИИ' }))
    expect(screen.getByRole('alert')).toHaveTextContent('В этом браузере голосовой звонок недоступен')
    expect(screen.getByRole('button', { name: 'Начать звонок' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Закрыть звонок' }))
    expect(screen.getByLabelText('Ваш вопрос')).toBeEnabled()
  })
})
