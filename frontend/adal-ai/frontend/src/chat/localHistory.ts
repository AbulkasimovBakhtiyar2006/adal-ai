import type { Conversation, HistoryTurn } from '../api/types'

export const GUEST_HISTORY_KEY = 'adal.guest-history.v1'
interface LocalChat extends Conversation { turns: HistoryTurn[] }

function read(): LocalChat[] {
  const value: unknown = JSON.parse(localStorage.getItem(GUEST_HISTORY_KEY) ?? '[]')
  if (!Array.isArray(value) || !value.every(item => item && typeof item.id === 'string' && typeof item.title === 'string' && Number.isFinite(item.updatedAt) && Array.isArray(item.turns))) {
    throw new Error('Invalid local history')
  }
  return value as LocalChat[]
}
function write(chats: LocalChat[]) { localStorage.setItem(GUEST_HISTORY_KEY, JSON.stringify(chats)) }

export const localHistory = {
  list: (): Conversation[] => read().map(({ id, title, updatedAt }) => ({ id, title, updatedAt })).sort((a, b) => b.updatedAt - a.updatedAt),
  create: (): Conversation => {
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('')
    const item = { id, title: '', updatedAt: Date.now() / 1000 }
    write([{ ...item, turns: [] }, ...read()])
    return item
  },
  history: (id?: string): HistoryTurn[] => read().find(item => item.id === id)?.turns ?? [],
  save: (id: string, turn: HistoryTurn) => {
    const chats = read()
    const chat = chats.find(item => item.id === id)
    if (!chat) throw new Error('Local conversation missing')
    chat.turns = [...chat.turns.filter(item => item.id !== turn.id), turn].slice(-100)
    chat.title ||= turn.question.slice(0, 100)
    chat.updatedAt = Date.now() / 1000
    write(chats)
  },
  clear: () => localStorage.removeItem(GUEST_HISTORY_KEY),
}
