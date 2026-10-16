import { useCallback, useReducer } from 'react'
import { ApiError, sendMessage } from '../api/client'
import type { HistoryTurn, Lang } from '../api/types'
import { chatReducer } from './reducer'

/** Случайный id. randomUUID есть только в защищённом контексте (HTTPS, localhost). */
function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function useChat(lang: Lang) {
  const [turns, dispatch] = useReducer(chatReducer, [])
  const busy = turns.some((turn) => turn.phase === 'pending')

  const deliver = useCallback(
    async (id: string, question: string) => {
      try {
        const reply = await sendMessage(question, lang, id)
        dispatch({ type: 'succeeded', id, reply })
      } catch (err) {
        const apiError = err instanceof ApiError ? err : new ApiError('INTERNAL')
        dispatch({ type: 'failed', id, code: apiError.code, retryAfter: apiError.retryAfter })
      }
    },
    [lang],
  )

  const send = useCallback(
    (question: string) => {
      const id = newId()
      dispatch({ type: 'submitted', id, question })
      void deliver(id, question)
    },
    [deliver],
  )

  const retry = useCallback(
    (id: string) => {
      const turn = turns.find((item) => item.id === id && item.phase === 'error')
      if (!turn || busy) return
      dispatch({ type: 'retried', id })
      void deliver(id, turn.question)
    },
    [turns, busy, deliver],
  )

  const loadHistory = useCallback((history: HistoryTurn[]) => dispatch({ type: 'historyLoaded', turns: history }), [])
  const clear = useCallback(() => dispatch({ type: 'cleared' }), [])

  return { turns, busy, send, retry, loadHistory, clear }
}
