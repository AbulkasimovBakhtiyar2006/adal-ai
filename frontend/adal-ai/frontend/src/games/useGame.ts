import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchGame, GameError, type GameState } from './api'

/** Polls a room; actions call `refresh` to see their effect without waiting for the next poll. */
export function useGame(code: string, token: string | null) {
  const [state, setState] = useState<GameState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [receivedAt, setReceivedAt] = useState(0)
  const sequence = useRef(0)
  const applied = useRef(0)
  const refresh = useCallback(async () => {
    const id = ++sequence.current
    try {
      const next = await fetchGame(code, token)
      if (id < applied.current) return next
      applied.current = id
      setState(next); setReceivedAt(performance.now()); setError(null)
      return next
    } catch (err) {
      if (id >= applied.current) setError(err instanceof GameError ? err.code : 'generic')
      return null
    }
  }, [code, token])
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      const next = await refresh()
      if (active && next?.phase !== 'finished') timer = setTimeout(() => void tick(), 900)
    }
    void tick()
    return () => { active = false; clearTimeout(timer) }
  }, [refresh])
  return { state, error, receivedAt, refresh }
}

export function useRemaining(state: GameState | null, receivedAt: number) {
  const [now, setNow] = useState(() => performance.now())
  const ticking = !!state && state.remainingMs > 0
  useEffect(() => {
    if (!ticking) return
    const timer = setInterval(() => setNow(performance.now()), 200)
    return () => clearInterval(timer)
  }, [ticking])
  if (!state) return 0
  return Math.max(0, state.remainingMs - Math.max(0, now - receivedAt))
}
