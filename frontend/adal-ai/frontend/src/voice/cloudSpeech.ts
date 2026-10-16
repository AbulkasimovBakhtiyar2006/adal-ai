import type { Lang } from '../api/types'
import { synthesizeSpeech } from '../api/client'

export type CloudSpeech = (text: string, lang: Lang, signal: AbortSignal) => Promise<void>

/** Each short passage owns its URL, playback and cancellation lifecycle. */
export const playCloudSpeech: CloudSpeech = async (text, lang, signal) => {
  const blob = await synthesizeSpeech(text, lang, signal)
  signal.throwIfAborted()
  const url = URL.createObjectURL(blob)
  const audio = new Audio(url)
  try {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timeout)
        signal.removeEventListener('abort', aborted)
        audio.onended = audio.onerror = null
        if (error) reject(error)
        else resolve()
      }
      const aborted = () => finish(new DOMException('Speech cancelled', 'AbortError'))
      const timeout = setTimeout(() => finish(new Error('playback_timeout')), 120_000)
      audio.onended = () => finish()
      audio.onerror = () => finish(new Error('playback_failed'))
      signal.addEventListener('abort', aborted, { once: true })
      if (signal.aborted) { aborted(); return }
      try { void audio.play().catch(error => finish(error)) } catch { finish(new Error('playback_failed')) }
    })
  } finally {
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
    URL.revokeObjectURL(url)
  }
}
