import type { Lang } from '../api/types'
import type { QuizQuestion } from '../quiz/content'

export type GameMode = 'live' | 'duel'
export type GamePhase = 'lobby' | 'question' | 'reveal' | 'finished'
type Localized = Record<Lang, string>

export interface GamePlayer { id: string; name: string; avatar: string; score: number; correct: number; rank: number; answered: boolean }
export interface GameState {
  code: string
  mode: GameMode
  title: string
  phase: GamePhase
  index: number
  total: number
  seconds: number
  isHost: boolean
  players: GamePlayer[]
  remainingMs: number
  answeredCount: number
  question: null | { text: Localized; options: Localized[]; correct?: number; counts?: number[]; explanation?: Localized | null }
  you?: { id: string; name: string; avatar: string; score: number; correct: number; streak: number; rank: number; answer: null | { choice: number; points: number | null; correct: boolean | null } }
}

/** `code` is the server's error detail (e.g. game_not_found) or 'network'. */
export class GameError extends Error {
  constructor(readonly code: string) { super(code) }
}

async function call(method: 'GET' | 'POST', path: string, token?: string, body?: unknown): Promise<unknown> {
  let response: Response
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    response = await fetch(`/api/games${path}`, {
      method, credentials: 'same-origin', signal: controller.signal,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { 'X-Game-Token': token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch { throw new GameError('network') } finally { clearTimeout(timer) }
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = (data as { detail?: unknown } | null)?.detail
    throw new GameError(typeof detail === 'string' && /^[a-z_]{1,40}$/.test(detail) ? detail : 'generic')
  }
  return data
}

const tokenKey = (code: string) => `adal.game.v1.${code}`
export function savedHostToken(code: string): string | null { return savedToken(`host.${code}`) }
export function savedToken(code: string): string | null {
  try { return sessionStorage.getItem(tokenKey(code)) } catch { return null }
}
function rememberToken(code: string, token: string) {
  try { sessionStorage.setItem(tokenKey(code), token) } catch { /* the game still works in this tab */ }
}

export async function createGame(mode: GameMode, seconds: number, questions: QuizQuestion[], title: string) {
  const payload = questions.map(item => ({ text: item.text, options: item.options, correct: item.correct, explanation: item.explanation }))
  const raw = await call('POST', '', undefined, { mode, seconds, title, questions: payload }) as { code: string; token: string }
  const game = { code: String(raw.code), token: String(raw.token) }
  rememberToken(`host.${game.code}`, game.token)
  return game
}

export async function joinGame(code: string, name: string, avatar: string) {
  const raw = await call('POST', `/${code}/join`, undefined, { name, avatar }) as { token: string }
  rememberToken(code, String(raw.token))
  return String(raw.token)
}

export const startGame = (code: string, token: string) => call('POST', `/${code}/start`, token)
export const nextStep = (code: string, token: string) => call('POST', `/${code}/next`, token)
export const sendAnswer = (code: string, token: string, index: number, choice: number) => call('POST', `/${code}/answer`, token, { index, choice })

export async function fetchGame(code: string, token?: string | null): Promise<GameState> {
  const raw = await call('GET', `/${code}`, token ?? undefined) as Record<string, unknown>
  const { is_host, remaining_ms, answered_count, ...rest } = raw
  return { ...(rest as unknown as GameState), isHost: is_host === true, remainingMs: Number(remaining_ms) || 0, answeredCount: Number(answered_count) || 0 }
}

export const isGameCode = (value: string) => /^\d{6}$/.test(value)
export const joinUrl = (code: string) => `${location.origin}/?game=${code}`
