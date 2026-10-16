import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceController, speechText, type Recognition } from './VoiceController'

class FakeRecognition implements Recognition {
  static instances: FakeRecognition[] = []
  lang = ''
  continuous = false
  interimResults = false
  onresult: Recognition['onresult'] = null
  onerror: Recognition['onerror'] = null
  onend: Recognition['onend'] = null
  start = vi.fn()
  abort = vi.fn()
  constructor() { FakeRecognition.instances.push(this) }
  result(text: string, isFinal = true) { this.onresult?.({ results: [{ isFinal, 0: { transcript: text } }] }) }
}
class FakeUtterance {
  text: string
  lang = ''
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(text: string) { this.text = text }
}
let spoken: FakeUtterance[]
let cancel: ReturnType<typeof vi.fn>
let controller: VoiceController
const mic = () => FakeRecognition.instances.at(-1)!
const flush = async () => { await Promise.resolve(); await Promise.resolve() }
beforeEach(() => {
  vi.useFakeTimers()
  FakeRecognition.instances = []
  spoken = []
  cancel = vi.fn()
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('SpeechRecognition', FakeRecognition)
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
  vi.stubGlobal('speechSynthesis', {
    speak: vi.fn((utterance: FakeUtterance) => spoken.push(utterance)), cancel,
    getVoices: () => [{ lang: 'ru-RU' }],
  })
  controller = new VoiceController('ru', 2000)
})
afterEach(() => { controller.end(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('voice conversation', () => {
  it('sends final speech once, reads the reply, then resumes listening', async () => {
    const ask = vi.fn(async () => '**Ответ** [источник](https://example.com).')
    controller.start(ask)
    expect(mic().lang).toBe('ru-RU')
    mic().result('Вопрос', false)
    expect(ask).not.toHaveBeenCalled()
    mic().result('Вопрос')
    mic().onend?.()
    mic().onend?.()
    expect(controller.getSnapshot().phase).toBe('thinking')
    await flush()
    expect(ask).toHaveBeenCalledExactlyOnceWith('Вопрос')
    expect(spoken[0].text).toBe('Ответ источник.')
    expect(FakeRecognition.instances).toHaveLength(1)
    spoken[0].onend?.()
    expect(FakeRecognition.instances).toHaveLength(2)
    expect(controller.getSnapshot().phase).toBe('listening')
  })
  it('does not play or reopen the microphone after hanging up while waiting', async () => {
    let resolve!: (value: string) => void
    controller.start(() => new Promise<string>(done => { resolve = done }))
    mic().result('Вопрос'); mic().onend?.()
    controller.end()
    resolve('Поздний ответ'); await flush()
    expect(spoken).toHaveLength(0)
    expect(controller.getSnapshot().active).toBe(false)
    expect(FakeRecognition.instances).toHaveLength(1)
  })
  it('ignores late recognition and speech callbacks after hangup', async () => {
    const ask = vi.fn(async () => 'Ответ')
    controller.start(ask)
    const oldResult = mic().onresult!
    const oldEnd = mic().onend!
    controller.end()
    oldResult({ results: [{ isFinal: true, 0: { transcript: 'Поздний вопрос' } }] }); oldEnd()
    expect(ask).not.toHaveBeenCalled()
    controller.start(ask); mic().result('Вопрос'); mic().onend?.(); await flush()
    const speechEnd = spoken[0].onend!
    controller.end(); speechEnd()
    expect(cancel).toHaveBeenCalled()
    expect(FakeRecognition.instances).toHaveLength(2)
  })
  it('pauses on permission, network and silence errors without retry loops', () => {
    const ask = vi.fn()
    for (const [error, expected] of [['not-allowed', 'permission'], ['network', 'network'], ['no-speech', 'silent']]) {
      controller.start(ask)
      const recognition = mic()
      recognition.onerror?.({ error })
      expect(controller.getSnapshot()).toMatchObject({ phase: 'paused', error: expected })
      expect(recognition.abort).toHaveBeenCalled()
    }
    expect(ask).not.toHaveBeenCalled()
    expect(FakeRecognition.instances).toHaveLength(3)
  })
  it('rejects oversized transcripts and empty recognition', () => {
    const ask = vi.fn()
    controller.start(ask); mic().result('a'.repeat(2001)); mic().onend?.()
    expect(controller.getSnapshot().error).toBe('long')
    controller.resume(); mic().onend?.()
    expect(controller.getSnapshot().error).toBe('silent')
    expect(ask).not.toHaveBeenCalled()
  })
  it('keeps the microphone muted after an answer and resumes on unmute', async () => {
    controller.start(async () => 'Ответ')
    mic().result('Вопрос'); mic().onend?.()
    controller.toggleMute(); await flush(); spoken[0].onend?.()
    expect(controller.getSnapshot()).toMatchObject({ muted: true, phase: 'paused' })
    expect(FakeRecognition.instances).toHaveLength(1)
    controller.toggleMute()
    expect(controller.getSnapshot().phase).toBe('listening')
  })
  it('allows interrupting speech without a late callback reopening the mic', async () => {
    controller.start(async () => 'Ответ')
    mic().result('Вопрос'); mic().onend?.(); await flush()
    const end = spoken[0].onend!
    controller.resume(); end()
    expect(cancel).toHaveBeenCalled()
    expect(FakeRecognition.instances).toHaveLength(2)
  })
  it('reports failed AI requests and stalled playback', async () => {
    controller.start(async () => undefined)
    mic().result('Вопрос'); mic().onend?.(); await flush()
    expect(controller.getSnapshot().error).toBe('answer')
    controller.read('id', 'Ответ')
    vi.advanceTimersByTime(45_000)
    expect(controller.getSnapshot().error).toBe('playback')
  })
  it('stops reading on a second click and splits long answers without losing text', () => {
    const text = 'Длинное предложение с важными подробностями. '.repeat(60).trim()
    controller.read('id', text)
    for (let index = 0; index < spoken.length; index++) spoken[index].onend?.()
    expect(spoken.map(item => item.text).join('')).toBe(text)
    expect(controller.getSnapshot().phase).toBe('idle')
    controller.read('id', 'Ещё ответ'); controller.read('id', 'Ещё ответ')
    expect(controller.getSnapshot().speakingId).toBeNull()
    expect(cancel).toHaveBeenCalled()
  })
  it('reports missing language and unsupported browsers', () => {
    controller = new VoiceController('kk', 2000)
    controller.read('id', 'Жауап')
    expect(controller.getSnapshot().error).toBe('language')
    vi.stubGlobal('SpeechRecognition', undefined)
    controller.start(vi.fn())
    expect(controller.getSnapshot().error).toBe('unsupported')
  })
  it('removes markup while preserving answer words', () => {
    expect(speechText('# Заголовок\n\n**Текст** и [ссылка](https://example.com)\n---\n*Примечание*')).toBe('Заголовок Текст и ссылка Примечание')
  })
})
