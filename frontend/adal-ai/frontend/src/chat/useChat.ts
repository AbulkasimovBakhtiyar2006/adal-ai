import { useCallback, useReducer } from 'react'
import { ApiError, sendMessage } from '../api/client'
import type { ChatAttachment, HistoryTurn, Lang, ResponseMode } from '../api/types'
import { chatReducer } from './reducer'

/** Случайный id. randomUUID есть только в защищённом контексте (HTTPS, localhost). */
function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function useChat(lang: Lang, conversationId?: string) {
  const [turns, dispatch] = useReducer(chatReducer, [])
  const busy = turns.some((turn) => turn.phase === 'pending')

  const deliver = useCallback(
    async (id: string, question: string, responseMode: ResponseMode = 'text', targetConversationId = conversationId, attachments: ChatAttachment[] = []) => {
      try {
        const reply = await sendMessage(question, lang, id, targetConversationId, responseMode, attachments)
        dispatch({ type: 'succeeded', id, reply })
        return reply
      } catch (err) {
        const apiError = err instanceof ApiError ? err : new ApiError('INTERNAL')
        dispatch({ type: 'failed', id, code: apiError.code, retryAfter: apiError.retryAfter })
      }
    },
    [lang, conversationId],
  )

  const send = useCallback(
    (question: string, responseMode: ResponseMode = 'text', targetConversationId = conversationId, attachments: ChatAttachment[] = []) => {
      const id = newId()
      dispatch({ type: 'submitted', id, question, responseMode, attachments })
      return deliver(id, question, responseMode, targetConversationId, attachments)
    },
    [deliver, conversationId],
  )

  const retry = useCallback(
    (id: string) => {
      const turn = turns.find((item) => item.id === id && item.phase === 'error')
      if (!turn || busy) return
      dispatch({ type: 'retried', id })
      return deliver(id, turn.question, turn.responseMode, conversationId, turn.attachments)
    },
    [turns, busy, deliver, conversationId],
  )

  const loadHistory = useCallback((history: HistoryTurn[]) => dispatch({ type: 'historyLoaded', turns: history }), [])
  const clear = useCallback(() => dispatch({ type: 'cleared' }), [])

  return { turns, busy, send, retry, loadHistory, clear }
}
