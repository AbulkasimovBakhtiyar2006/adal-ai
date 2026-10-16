import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LangProvider } from '../i18n/LangProvider'
import { kazakhstanBank, shuffledRound, topicIds, topicPool } from './bank'
import { Blitz } from './Blitz'
import { BLITZ_SECONDS, readBlitzBest } from './blitzScore'
import { gamesCopy } from './copy'
import { GamesHub } from './GamesHub'
import { PlayerRoom } from './Rooms'
import { Podium, QrCode } from './ui'
import type { GameState } from './api'

const c = gamesCopy.ru
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const ui = (node: React.ReactNode) => render(<LangProvider>{node}</LangProvider>)
const question = { text: { ru: 'Столица?', kk: 'Астана?' }, options: [{ ru: 'Астана', kk: 'Астана' }, { ru: 'Алматы', kk: 'Алматы' }] }
const players = [
  { id: 'a', name: 'Аружан', avatar: 'asel', score: 1900, correct: 2, rank: 1, answered: false },
  { id: 'b', name: 'Диас', avatar: 'wolf', score: 950, correct: 1, rank: 2, answered: false },
]
const state = (patch: Record<string, unknown>) => ({
  code: '123456', mode: 'live', title: '', phase: 'lobby', index: -1, total: 2, seconds: 20, is_host: false,
  players, remaining_ms: 0, question: null,
  you: { id: 'b', name: 'Диас', avatar: 'wolf', score: 950, correct: 1, streak: 0, rank: 2, answer: null }, ...patch,
})

beforeEach(() => { sessionStorage.clear(); history.replaceState(null, '', '/') })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('question pools', () => {
  it('offers bilingual questions with distinct ids and a valid key in every topic', () => {
    expect(kazakhstanBank.length).toBeGreaterThanOrEqual(20)
    const mixed = topicPool('mixed')
    expect(new Set(mixed.map(item => item.id)).size).toBe(mixed.length)
    for (const topic of topicIds) for (const item of topicPool(topic)) {
      expect(item.text.ru && item.text.kk).toBeTruthy()
      expect(item.options.length).toBeGreaterThanOrEqual(2)
      expect(item.options.length).toBeLessThanOrEqual(4)
      expect(item.options.every(option => option.ru && option.kk)).toBe(true)
      expect(new Set(item.options.map(option => option.ru)).size).toBe(item.options.length)
    }
  })

  it('shuffles options but keeps the right answer', () => {
    for (const item of shuffledRound('kazakhstan', 50)) {
      const original = kazakhstanBank.find(source => source.id === item.id)!
      expect(item.options[item.correct]).toEqual(original.options[original.correct])
    }
  })
})

it('draws a QR code for the join link', () => {
  const { container } = render(<QrCode value="https://adal.example/?game=123456" label="QR" />)
  expect(screen.getByRole('img', { name: 'QR' })).toBeInTheDocument()
  expect(container.querySelector('path')?.getAttribute('d')?.length).toBeGreaterThan(100)
})

it('announces the winner, or a draw when the top scores tie', () => {
  const finished = { ...state({ phase: 'finished' }), isHost: false, remainingMs: 0, answeredCount: 0 } as unknown as GameState
  const { unmount } = ui(<Podium state={finished} c={c} meId="b" />)
  expect(screen.getByRole('heading', { name: `${c.winner}: Аружан 🏆` })).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent(`${c.yourPlace}: 2`)
  unmount()
  const tie = { ...finished, players: players.map(player => ({ ...player, rank: 1 })) }
  ui(<Podium state={tie} c={c} meId="a" />)
  expect(screen.getByRole('heading', { name: c.draw })).toBeInTheDocument()
})

it('joins by code from a QR link and remembers the player token', async () => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/join')) {
      expect(JSON.parse(String(init?.body))).toEqual({ name: 'Диас', avatar: 'wolf' })
      return json({ player_id: 'b', token: 'player-token' })
    }
    expect(new Headers(init?.headers).get('X-Game-Token')).toBe('player-token')
    return json(state({}))
  })
  vi.stubGlobal('fetch', fetcher)
  ui(<GamesHub initialCode="123456" onHome={() => {}} />)
  expect(screen.getByPlaceholderText(c.codePlaceholder)).toHaveValue('123456')
  fireEvent.change(screen.getByPlaceholderText(c.namePlaceholder), { target: { value: 'Диас' } })
  fireEvent.click(screen.getByRole('radio', { name: 'wolf' }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: `${c.join} →` })) })
  expect(await screen.findByRole('heading', { name: c.youAreIn })).toBeInTheDocument()
  expect(sessionStorage.getItem('adal.game.v1.123456')).toBe('player-token')
  expect(location.search).toBe('?game=123456')
})

it('shows a readable error for an unknown code', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ detail: 'game_not_found' }, 404)))
  ui(<GamesHub entry="join" onHome={() => {}} />)
  fireEvent.change(screen.getByPlaceholderText(c.codePlaceholder), { target: { value: '99-99-99' } })
  expect(screen.getByPlaceholderText(c.codePlaceholder)).toHaveValue('999999')
  fireEvent.change(screen.getByPlaceholderText(c.namePlaceholder), { target: { value: 'Аня' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: `${c.join} →` })) })
  expect(await screen.findByRole('alert')).toHaveTextContent(c.errors.game_not_found)
})

it('lets a player answer and then shows the verdict at the reveal', async () => {
  let current = state({ phase: 'question', index: 0, remaining_ms: 15000, question })
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/answer')) {
      expect(JSON.parse(String(init?.body))).toEqual({ index: 0, choice: 0 })
      current = state({ phase: 'question', index: 0, remaining_ms: 12000, question, you: { ...current.you, answer: { choice: 0, points: null, correct: null } } })
      return json({ ok: true })
    }
    return json(current)
  })
  vi.stubGlobal('fetch', fetcher)
  ui(<PlayerRoom code="123456" token="player-token" onExit={() => {}} />)
  const capital = await screen.findByRole('button', { name: /Астана/ })
  await act(async () => { fireEvent.click(capital) })
  expect(await screen.findByText(c.answerSent)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Алматы/ })).not.toBeInTheDocument()

  current = state({ phase: 'reveal', index: 0, question: { ...question, correct: 0, counts: [2, 0], explanation: null },
    you: { ...current.you, score: 1900, rank: 1, streak: 2, answer: { choice: 0, points: 950, correct: true } } })
  expect(await screen.findByRole('heading', { name: c.correct }, { timeout: 2000 })).toBeInTheDocument()
  expect(screen.getByText(`+950 ${c.points}`)).toBeInTheDocument()
})

it('counts blitz answers for one minute and keeps the record', () => {
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
  ui(<Blitz topic="kazakhstan" onExit={() => {}} />)
  for (let i = 0; i < 3; i++) {
    const heading = screen.getByRole('heading', { level: 2 }).textContent
    const item = kazakhstanBank.find(q => q.text.ru === heading)!
    fireEvent.click(screen.getByRole('button', { name: new RegExp(item.options[item.correct].ru) }))
    act(() => { vi.advanceTimersByTime(500) })
  }
  act(() => { vi.advanceTimersByTime(BLITZ_SECONDS * 1000) })
  expect(screen.getByRole('heading', { name: c.blitzOver })).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent(c.newRecord)
  expect(readBlitzBest('kazakhstan')).toBe(3)
})
