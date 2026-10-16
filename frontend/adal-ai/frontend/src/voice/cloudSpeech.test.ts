import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { playCloudSpeech } from './cloudSpeech'

class FakeAudio {
  static current: FakeAudio
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  play = vi.fn(async () => {})
  pause = vi.fn()
  load = vi.fn()
  removeAttribute = vi.fn()
  constructor() { FakeAudio.current = this }
}

beforeEach(() => {
  vi.stubGlobal('Audio', FakeAudio)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:audio')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn(async () => new Response('ID3', { headers: { 'Content-Type': 'audio/mpeg' } })))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('sends text and language to the server and cleans up after playback', async () => {
  const playing = playCloudSpeech('Сәлем!', 'kk', new AbortController().signal)
  await vi.waitFor(() => expect(FakeAudio.current?.play).toHaveBeenCalled())
  const [, options] = vi.mocked(fetch).mock.calls[0]
  expect(JSON.parse(String(options?.body))).toEqual({ text: 'Сәлем!', lang: 'kk' })
  FakeAudio.current.onended?.()
  await playing
  expect(FakeAudio.current.pause).toHaveBeenCalled()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:audio')
})

it('stops playback and releases audio on cancellation', async () => {
  const abort = new AbortController()
  const playing = playCloudSpeech('Ответ', 'ru', abort.signal)
  const rejected = expect(playing).rejects.toMatchObject({ name: 'AbortError' })
  await vi.waitFor(() => expect(FakeAudio.current?.play).toHaveBeenCalled())
  abort.abort()
  await rejected
  expect(FakeAudio.current.pause).toHaveBeenCalled()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:audio')
})

it('does not play a response that arrives after cancellation', async () => {
  let resolve!: (response: Response) => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(done => { resolve = done })))
  const abort = new AbortController()
  const playing = playCloudSpeech('Ответ', 'ru', abort.signal)
  const rejected = expect(playing).rejects.toMatchObject({ name: 'AbortError' })
  abort.abort()
  resolve(new Response('ID3', { headers: { 'Content-Type': 'audio/mpeg' } }))
  await rejected
  expect(URL.createObjectURL).not.toHaveBeenCalled()
})

it('rejects server error responses before creating an audio player', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })))
  await expect(playCloudSpeech('Ответ', 'ru', new AbortController().signal)).rejects.toThrow('speech_failed')
  expect(URL.createObjectURL).not.toHaveBeenCalled()
})
