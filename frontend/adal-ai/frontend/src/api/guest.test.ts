import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createConversation, deleteSession, getConfig, getConversations, getHistory, sendMessage } from './client'
import { GUEST_HISTORY_KEY } from '../chat/localHistory'

const reply = { answer: 'Ответ', sources: [], status: 'answered', ai_mode: 'real' }
const config = { ai_mode: 'real', max_message_chars: 2000, guest_local: true, user: null }
function response(body: unknown) { return new Response(JSON.stringify(body), { status: 200 }) }
beforeEach(() => { localStorage.clear() })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('keeps guest history locally across configuration reloads and sends transient context', async () => {
  const fetcher = vi.fn(async (url: string) => response(url === '/api/config' ? config : reply))
  vi.stubGlobal('fetch', fetcher)
  await getConfig()
  const chat = await createConversation()
  await sendMessage('Первый вопрос', 'ru', 'one', chat.id)
  await getConfig()
  expect(await getConversations()).toEqual([expect.objectContaining({ id: chat.id, title: 'Первый вопрос' })])
  expect((await getHistory(chat.id))[0].reply.answer).toBe('Ответ')
  await sendMessage('Второй вопрос', 'ru', 'two', chat.id)
  const calls = fetcher.mock.calls as unknown as Array<[string, RequestInit]>
  const last = calls.at(-1)!
  expect(JSON.parse(String(last[1].body))).toMatchObject({ local_only: true, context: [{ question: 'Первый вопрос', answer: 'Ответ' }] })
  expect(calls.every(([url]) => ['/api/config', '/api/chat'].includes(url))).toBe(true)
  await deleteSession()
  expect(await getConversations()).toEqual([])
  expect(localStorage.getItem(GUEST_HISTORY_KEY)).toBeNull()
})

it('separates guest history from account data and restores it after logout', async () => {
  let user: null | { id: string; name: string; email: string } = null
  vi.stubGlobal('fetch', vi.fn(async (url: string) => response(url === '/api/config' ? { ...config, user } : { conversations: [{ id: 'cloud', title: 'Account', updated_at: 123 }] })))
  await getConfig()
  const guest = await createConversation()
  user = { id: 'google:user', name: 'User', email: 'user@example.com' }
  await getConfig()
  expect((await getConversations())[0].id).toBe('cloud')
  user = null
  await getConfig()
  expect((await getConversations())[0].id).toBe(guest.id)
})

it('reports storage failures instead of pretending history was saved', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => response(config)))
  await getConfig()
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded') })
  await expect(createConversation()).rejects.toMatchObject({ code: 'LOCAL_STORAGE' })
})

it('rejects expired account sessions instead of mixing them with guest data', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/config'
    ? response({ ...config, user: { id: 'google:user', name: 'User', email: 'user@example.com' } })
    : new Response('{}', { status: 401 })))
  await getConfig()
  await expect(getConversations()).rejects.toMatchObject({ code: 'SESSION_CHANGED' })
})
