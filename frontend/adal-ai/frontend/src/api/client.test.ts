import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, normalizeReply, safeHttpUrl, sendMessage } from './client'

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('safeHttpUrl', () => {
  it('пропускает только абсолютные http(s)-адреса', () => {
    expect(safeHttpUrl('https://example.org/x')).toBe('https://example.org/x')
    expect(safeHttpUrl('http://example.org')).toBe('http://example.org/')
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull()
    expect(safeHttpUrl('data:text/html,hi')).toBeNull()
    expect(safeHttpUrl('/relative/path')).toBeNull()
    expect(safeHttpUrl(null)).toBeNull()
  })
})

describe('normalizeReply', () => {
  it('отклоняет пустой ответ', () => {
    expect(() => normalizeReply({ answer: '  ', sources: [] })).toThrowError(ApiError)
  })

  it('не придумывает статус и чистит источники', () => {
    const reply = normalizeReply({
      answer: 'Текст',
      status: 'something_new',
      ai_mode: 'real',
      sources: [
        { title: 'Есть ссылка', url: 'https://example.org' },
        { title: 'Плохая ссылка', url: 'javascript:alert(1)' },
        { title: '', url: 'https://example.org' },
        'строка вместо объекта',
      ],
    })
    expect(reply.status).toBeNull()
    expect(reply.aiMode).toBe('real')
    expect(reply.sources).toEqual([
      { title: 'Есть ссылка', url: 'https://example.org/', details: null },
      { title: 'Плохая ссылка', url: null, details: null },
    ])
  })

  it('не делает вывод о статусе по отсутствию источников', () => {
    expect(normalizeReply({ answer: 'Привет', sources: [] }).status).toBeNull()
  })
})

describe('sendMessage', () => {
  it('передаёт client_id и язык, получает ответ', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { answer: 'Да', sources: [], status: 'answered', ai_mode: 'mock' }))
    vi.stubGlobal('fetch', fetchMock)
    const reply = await sendMessage('Вопрос', 'kk', 'id-1')
    expect(reply.answer).toBe('Да')
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ message: 'Вопрос', lang: 'kk', client_id: 'id-1' })
    expect(init.credentials).toBe('same-origin')
  })

  it('переводит ответ сервера с ошибкой в код', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(429, { error: { code: 'RATE_LIMITED', retry_after: 30 } })))
    await expect(sendMessage('Q', 'ru', 'id')).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfter: 30 })
  })

  it('неизвестный код ошибки становится INTERNAL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, { error: { code: 'SOMETHING' } })))
    await expect(sendMessage('Q', 'ru', 'id')).rejects.toMatchObject({ code: 'INTERNAL' })
  })

  it('сбой сети становится NETWORK', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(sendMessage('Q', 'ru', 'id')).rejects.toMatchObject({ code: 'NETWORK' })
  })
})

it('only accepts private local Google Search suggestion frames', () => {
  const base = { answer: 'Ответ', sources: [] }
  expect(normalizeReply({ ...base, search_suggestions_url: '/api/search-suggestions/chat_1' }).searchSuggestionsUrl)
    .toBe('/api/search-suggestions/chat_1')
  for (const url of ['https://evil.example/', '//evil.example/', '/api/search-suggestions/../admin', 'javascript:alert(1)']) {
    expect(normalizeReply({ ...base, search_suggestions_url: url }).searchSuggestionsUrl).toBeUndefined()
  }
})
