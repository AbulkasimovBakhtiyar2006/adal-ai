import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { LangProvider } from './i18n/LangProvider'

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
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
    calls.push({ method, url, body })
    if (url === '/api/config') return json(200, { ai_mode: 'mock', max_message_chars: 2000 })
    if (url === '/api/history') return json(200, { turns: [] })
    if (url === '/api/chat') return (queue.shift() ?? (() => json(500, {})))()
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
})

describe('App', () => {
  it('показывает главную страницу и примеры как подсказки', async () => {
    const server = fakeServer([])
    const user = userEvent.setup()
    renderApp()

    expect(await screen.findByRole('heading', { name: 'Задайте вопрос об официальных документах' })).toBeInTheDocument()
    expect(screen.getByText(/Не является официальным государственным органом/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Слышащее государство/ }))
    expect(screen.getByLabelText('Ваш вопрос')).toHaveValue(
      'Объясни концепцию «Слышащее государство» по официальным источникам.',
    )
    expect(server.chatCalls()).toHaveLength(0)
  })

  it('показывает индикатор ожидания, затем уточняющий вопрос', async () => {
    let release: (response: Response) => void = () => {}
    fakeServer([() => new Promise<Response>((resolve) => (release = resolve))])
    const user = userEvent.setup()
    renderApp()

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

    await user.type(await screen.findByLabelText('Ваш вопрос'), 'Вопрос{Enter}')
    expect(await screen.findByText('Недостаточно подтверждённой информации')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('Техническая ошибка')).toBeNull()
  })

  it('повторяет вопрос после ошибки без дубликата', async () => {
    const server = fakeServer([() => json(502, { error: { code: 'AI_FAILED' } }), answer()])
    const user = userEvent.setup()
    renderApp()

    await user.type(await screen.findByLabelText('Ваш вопрос'), 'Один вопрос{Enter}')
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Техническая ошибка')).toBeInTheDocument()
    expect(within(alert).getByText('Не удалось получить ответ от ИИ.')).toBeInTheDocument()

    await user.click(within(alert).getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByText('Тестовый ответ')).toBeInTheDocument()

    const [first, second] = server.chatCalls()
    expect(second.body?.client_id).toBe(first.body?.client_id)
    expect(screen.getAllByText('Один вопрос')).toHaveLength(1)
  })

  it('переключает язык интерфейса и передаёт его на сервер', async () => {
    const server = fakeServer([answer()])
    const user = userEvent.setup()
    renderApp()

    await screen.findByRole('heading', { name: 'Задайте вопрос об официальных документах' })
    await user.click(screen.getByRole('button', { name: 'KZ' }))

    expect(screen.getByRole('heading', { name: 'Ресми құжаттар туралы сұрақ қойыңыз' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'KZ' })).toHaveAttribute('aria-pressed', 'true')
    expect(document.documentElement.lang).toBe('kk')

    await user.type(screen.getByLabelText('Сіздің сұрағыңыз'), 'Сұрақ{Enter}')
    await screen.findByText('Тестовый ответ')
    expect(server.chatCalls()[0].body?.lang).toBe('kk')
  })

  it('начинает новый диалог после подтверждения', async () => {
    const server = fakeServer([answer()])
    const user = userEvent.setup()
    renderApp()

    await user.type(await screen.findByLabelText('Ваш вопрос'), 'Вопрос{Enter}')
    await screen.findByText('Тестовый ответ')

    await user.click(screen.getByRole('button', { name: 'Новый диалог' }))
    const dialog = screen.getByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Начать новый' }))

    await waitFor(() => expect(screen.queryByText('Тестовый ответ')).toBeNull())
    expect(screen.getByRole('heading', { name: 'Задайте вопрос об официальных документах' })).toBeInTheDocument()
    expect(server.calls.some((call) => call.method === 'DELETE' && call.url === '/api/history')).toBe(true)
  })
})
