import type { Lang } from '../api/types'
import { selectVoice, speechChunks } from './speech'
import type { CloudSpeech } from './cloudSpeech'

export type VoiceReply = string | { answer: string; responseLanguage?: Lang }

export interface Recognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  abort(): void
}
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition
  webkitSpeechRecognition?: new () => Recognition
}
export type VoiceError = 'unsupported' | 'insecure' | 'permission' | 'network' | 'microphone' | 'language' | 'silent' | 'long' | 'answer' | 'playback'
export interface VoiceState {
  active: boolean
  phase: 'idle' | 'listening' | 'thinking' | 'speaking' | 'paused'
  muted: boolean
  transcript: string
  error: VoiceError | null
  speakingId: string | null
  usingFallback: boolean
}
const initial: VoiceState = { active: false, phase: 'idle', muted: false, transcript: '', error: null, speakingId: null, usingFallback: false }

/** Strip display markup without reading URLs or Markdown punctuation aloud. */
export function speechText(text: string): string {
  return text.replace(/\[\d+(?:\s*[,–-]\s*\d+)*\](?:\([^)]*\))?/g, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(?:https?:\/\/|www\.)\S+/g, ' ')
    .replace(/ +([.,!?;:])/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/(^|\n)\s{0,3}[#>]+\s?/g, '$1')
    .replace(/[*_`~|]/g, '').replace(/(^|\n)\s*[-=]{3,}\s*(?=\n|$)/g, '$1')
    .replace(/\s+/g, ' ').trim()
}

/** One owner for the microphone and speech queue. Generation tokens discard late callbacks. */
export class VoiceController {
  private state: VoiceState = initial
  private listeners = new Set<() => void>()
  private recognition: Recognition | null = null
  private utterance: SpeechSynthesisUtterance | null = null
  private generation = 0
  private speechGeneration = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private waitingTimer: ReturnType<typeof setTimeout> | undefined
  private cancelVoiceWait?: () => void
  private ask?: (question: string) => Promise<VoiceReply | undefined>
  private cloudAbort?: AbortController
  constructor(private lang: Lang, private maxChars: number, private cloudSpeech?: CloudSpeech) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  getSnapshot = () => this.state
  private update(next: Partial<VoiceState>) {
    this.state = { ...this.state, ...next }
    this.listeners.forEach(listener => listener())
  }
  private get recognizer() {
    const browser = window as SpeechWindow
    return browser.SpeechRecognition ?? browser.webkitSpeechRecognition
  }
  get canSpeak() { return !!this.cloudSpeech || this.canSpeakBrowser }
  private get canSpeakBrowser() { return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window }
  get unavailable(): VoiceError | null {
    if (!window.isSecureContext) return 'insecure'
    if (!this.recognizer || !this.canSpeak) return 'unsupported'
    return null
  }
  private stopMic() {
    const recognition = this.recognition
    this.recognition = null
    if (recognition) {
      recognition.onresult = recognition.onerror = recognition.onend = null
      recognition.abort()
    }
  }
  private stopSpeech() {
    this.cloudAbort?.abort()
    this.cloudAbort = undefined
    this.speechGeneration++
    clearTimeout(this.timer)
    this.cancelVoiceWait?.()
    this.cancelVoiceWait = undefined
    if (this.utterance) {
      this.utterance.onend = this.utterance.onerror = this.utterance.onstart = null
      this.utterance = null
      window.speechSynthesis.cancel()
    }
  }
  end = () => {
    this.generation++
    clearTimeout(this.waitingTimer)
    this.stopMic()
    this.stopSpeech()
    this.ask = undefined
    this.update({ ...initial })
  }
  start = (ask: (question: string) => Promise<VoiceReply | undefined>) => {
    this.end()
    if (this.unavailable) { this.update({ error: this.unavailable }); return }
    this.ask = ask
    this.update({ active: true })
    this.listen()
  }
  private fail(error: VoiceError) {
    this.stopMic()
    this.stopSpeech()
    this.update({ error, phase: this.state.active ? 'paused' : 'idle', speakingId: null })
  }
  private listen = () => {
    if (!this.state.active || this.state.muted) return
    const Constructor = this.recognizer
    if (!Constructor) { this.fail('unsupported'); return }
    this.stopMic()
    const generation = this.generation
    const recognition = new Constructor()
    this.recognition = recognition
    recognition.lang = this.lang === 'kk' ? 'kk-KZ' : 'ru-RU'
    recognition.continuous = false
    recognition.interimResults = true
    let finalText = ''
    this.update({ phase: 'listening', transcript: '', error: null, speakingId: null })
    recognition.onresult = event => {
      if (generation !== this.generation || recognition !== this.recognition) return
      const results = Array.from(event.results)
      finalText = results.filter(result => result.isFinal).map(result => result[0].transcript).join(' ').trim()
      this.update({ transcript: results.map(result => result[0].transcript).join(' ').trim() })
    }
    recognition.onerror = event => {
      if (generation !== this.generation || recognition !== this.recognition) return
      const errors: Record<string, VoiceError> = {
        'not-allowed': 'permission', 'service-not-allowed': 'permission',
        'audio-capture': 'microphone', network: 'network', 'no-speech': 'silent',
        'language-not-supported': 'language',
      }
      this.fail(errors[event.error] ?? 'microphone')
    }
    recognition.onend = () => {
      if (generation !== this.generation || recognition !== this.recognition) return
      this.recognition = null
      recognition.onresult = recognition.onerror = recognition.onend = null
      if (!finalText) { this.fail('silent'); return }
      if (finalText.length > this.maxChars) { this.fail('long'); return }
      void this.deliver(finalText, generation)
    }
    try { recognition.start() } catch { this.fail('microphone') }
  }
  private async deliver(question: string, generation: number) {
    this.update({ phase: 'thinking', transcript: question })
    let waitingSpeech = false
    let readyAnswer: VoiceReply | undefined
    const playAnswer = () => {
      if (generation !== this.generation || !readyAnswer) return
      const answer = typeof readyAnswer === 'string' ? { answer: readyAnswer } : readyAnswer
      this.speak(answer.answer, null, () => {
        if (this.state.muted) this.update({ phase: 'paused' })
        else this.listen()
      }, 'speaking', undefined, answer.responseLanguage ?? this.lang)
    }
    // A quick reply skips the acknowledgement. The request runs while it is spoken.
    if (!this.cloudSpeech) this.waitingTimer = setTimeout(() => {
      if (generation !== this.generation) return
      waitingSpeech = true
      const finished = () => {
        waitingSpeech = false
        playAnswer()
      }
      this.speak(
        this.lang === 'kk'
          ? 'Қазір жауап беру үшін ақпаратты нақтылап алайын.'
          : 'Так, сейчас уточню информацию для ответа.',
        null, finished, 'thinking', finished,
      )
    }, 650)
    try {
      const answer = await this.ask?.(question)
      if (generation !== this.generation) return
      clearTimeout(this.waitingTimer)
      if (!answer) { this.fail('answer'); return }
      readyAnswer = answer
      if (!waitingSpeech) playAnswer()
    } catch {
      if (generation === this.generation) {
        clearTimeout(this.waitingTimer)
        this.fail('answer')
      }
    }
  }

  toggleMute = () => {
    const muted = !this.state.muted
    this.update({ muted })
    if (muted && this.state.phase === 'listening') {
      this.stopMic()
      this.update({ phase: 'paused' })
    } else if (!muted && this.state.phase === 'paused') this.listen()
  }
  resume = () => {
    if (!this.state.active || this.state.phase === 'thinking') return
    this.stopSpeech()
    this.update({ muted: false })
    this.listen()
  }
  read = (id: string, text: string, lang: Lang = this.lang) => {
    const wasSpeaking = this.state.speakingId === id
    this.end()
    if (!wasSpeaking) this.speak(text, id, () => this.update({ phase: 'idle', speakingId: null }), 'speaking', undefined, lang)
  }
  private speak(
    text: string, id: string | null, done: () => void,
    phase: VoiceState['phase'] = 'speaking', onFailure?: () => void,
    lang: Lang = this.lang,
  ) {
    if (!this.cloudSpeech || onFailure) { this.speakBrowser(text, id, done, phase, onFailure, lang); return }
    this.stopSpeech()
    const chunks = speechChunks(speechText(text), 1200)
    if (!chunks.length) { this.fail('playback'); return }
    const abort = new AbortController()
    this.cloudAbort = abort
    this.update({ phase, speakingId: id, error: null, usingFallback: false })
    const play = async () => {
      for (let index = 0; index < chunks.length; index++) {
        try { await this.cloudSpeech!(chunks[index], lang, abort.signal) }
        catch {
          if (abort.signal.aborted) return
          this.update({ usingFallback: true })
          this.speakBrowser(chunks.slice(index).join(''), id, done, phase, onFailure, lang)
          return
        }
        if (abort.signal.aborted) return
      }
      this.cloudAbort = undefined
      done()
    }
    void play()
  }
  private speakBrowser(
    text: string, id: string | null, done: () => void,
    phase: VoiceState['phase'] = 'speaking', onFailure?: () => void,
    lang: Lang = this.lang,
  ) {
    const failed = (error: VoiceError) => {
      if (onFailure) { this.stopSpeech(); onFailure() }
      else this.fail(error)
    }
    if (!this.canSpeakBrowser) { failed('unsupported'); return }
    this.stopSpeech()
    const clean = speechText(text)
    const chunks = speechChunks(clean)
    if (!chunks.length) { failed('playback'); return }
    const language = lang === 'kk' ? 'kk-KZ' : 'ru-RU'
    const synthesis = window.speechSynthesis
    let voice: SpeechSynthesisVoice | undefined
    const generation = this.generation
    const speechGeneration = this.speechGeneration
    const current = () => generation === this.generation && speechGeneration === this.speechGeneration
    this.update({ phase, speakingId: id, error: null })
    const next = () => {
      if (!current()) return
      const chunk = chunks.shift()
      if (!chunk) { this.utterance = null; done(); return }
      const utterance = new SpeechSynthesisUtterance(chunk)
      this.utterance = utterance
      utterance.lang = language
      if (voice) utterance.voice = voice
      utterance.pitch = 1
      utterance.rate = 1
      utterance.onend = () => { if (current()) { clearTimeout(this.timer); next() } }
      utterance.onerror = () => { if (current()) failed('playback') }
      // A blocked or stalled browser must not leave the call stuck forever.
      this.timer = setTimeout(() => { if (current()) failed('playback') }, 45_000)
      try { window.speechSynthesis.speak(utterance) } catch { failed('playback') }
    }
    const begin = () => {
      if (!current()) return
      this.cancelVoiceWait?.()
      this.cancelVoiceWait = undefined
      const voices = synthesis.getVoices()
      voice = selectVoice(voices, lang)
      if (voices.length && !voice) { failed('language'); return }
      next()
    }
    if (synthesis.getVoices().length) begin()
    else {
      // Chrome can expose an empty list until voiceschanged fires on first use.
      const changed = () => { if (synthesis.getVoices().length) begin() }
      const timeout = setTimeout(begin, 1200)
      synthesis.addEventListener('voiceschanged', changed)
      this.cancelVoiceWait = () => {
        clearTimeout(timeout)
        synthesis.removeEventListener('voiceschanged', changed)
      }
      changed()
    }
  }
}
