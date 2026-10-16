import { describe, expect, it } from 'vitest'
import type { ChatReply } from '../api/types'
import { chatReducer, type Turn } from './reducer'

const reply: ChatReply = { answer: 'Ответ', sources: [], status: 'answered', aiMode: 'mock' }

describe('chatReducer', () => {
  it('повтор после ошибки оставляет один и тот же вопрос', () => {
    let turns: Turn[] = chatReducer([], { type: 'submitted', id: 't1', question: 'Вопрос' })
    turns = chatReducer(turns, { type: 'failed', id: 't1', code: 'AI_FAILED', retryAfter: null })
    turns = chatReducer(turns, { type: 'retried', id: 't1' })
    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({ id: 't1', question: 'Вопрос', phase: 'pending', error: null })

    turns = chatReducer(turns, { type: 'succeeded', id: 't1', reply })
    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({ phase: 'done', reply })
  })

  it('новый вопрос убирает неудачный ход, которого нет на сервере', () => {
    let turns = chatReducer([], { type: 'submitted', id: 't1', question: 'Первый' })
    turns = chatReducer(turns, { type: 'failed', id: 't1', code: 'NETWORK', retryAfter: null })
    turns = chatReducer(turns, { type: 'submitted', id: 't2', question: 'Второй' })
    expect(turns.map((turn) => turn.id)).toEqual(['t2'])
  })

  it('повтор не трогает успешный ход', () => {
    let turns = chatReducer([], { type: 'submitted', id: 't1', question: 'Вопрос' })
    turns = chatReducer(turns, { type: 'succeeded', id: 't1', reply })
    expect(chatReducer(turns, { type: 'retried', id: 't1' })).toEqual(turns)
  })

  it('загружает историю и очищает её', () => {
    const turns = chatReducer([], { type: 'historyLoaded', turns: [{ id: 'h1', question: 'Q', reply }] })
    expect(turns[0]).toMatchObject({ id: 'h1', phase: 'done' })
    expect(chatReducer(turns, { type: 'cleared' })).toEqual([])
  })
})
