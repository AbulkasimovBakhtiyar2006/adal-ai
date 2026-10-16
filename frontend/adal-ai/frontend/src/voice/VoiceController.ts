import type { Lang } from '../api/types'

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
}
const initial: VoiceState = { active: false, phase: 'idle', muted: false, transcript: '', error: null, speakingId: null }

/** Strip display markup without reading URLs or Markdown punctuation aloud. */
export function speechText(text: string): string {
  return text.replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
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
  private ask?: (question: string) => Promise<string | undefined>
  constructor(private lang: Lang, private maxChars: number) {}
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
  get canSpeak() { return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window }
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
    this.speechGeneration++
    clearTimeout(this.timer)
    if (this.utterance) {
      this.utterance.onend = this.utterance.onerror = this.utterance.onstart = null
      this.utterance = null
      window.speechSynthesis.cancel()
    }
  }
  end = () => {
    this.generation++
    this.stopMic()
    this.stopSpeech()
    this.ask = undefined
    this.update({ ...initial })
  }
  start = (ask: (question: string) => Promise<string | undefined>) => {
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
    try {
      const answer = await this.ask?.(question)
      if (generation !== this.generation) return
      if (!answer) { this.fail('answer'); return }
      this.speak(answer, null, () => {
        if (this.state.muted) this.update({ phase: 'paused' })
        else this.listen()
      })
    } catch { if (generation === this.generation) this.fail('answer') }
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
  read = (id: string, text: string) => {
    const wasSpeaking = this.state.speakingId === id
    this.end()
    if (!wasSpeaking) this.speak(text, id, () => this.update({ phase: 'idle', speakingId: null }))
  }
  private speak(text: string, id: string | null, done: () => void) {
    if (!this.canSpeak) { this.fail('unsupported'); return }
    this.stopSpeech()
    const clean = speechText(text)
    const chunks = clean.match(/.{1,180}(?:\s|$)|\S{1,180}/g) ?? []
    if (!chunks.length) { this.fail('playback'); return }
    const language = this.lang === 'kk' ? 'kk-KZ' : 'ru-RU'
    const voices = window.speechSynthesis.getVoices()
    const voice = voices.find(item => item.lang.toLowerCase() === language.toLowerCase())
      ?? voices.find(item => item.lang.toLowerCase().startsWith(this.lang))
    if (voices.length && !voice) { this.fail('language'); return }
    const generation = this.generation
    const speechGeneration = this.speechGeneration
    const current = () => generation === this.generation && speechGeneration === this.speechGeneration
    this.update({ phase: 'speaking', speakingId: id, error: null })
    const next = () => {
      if (!current()) return
      const chunk = chunks.shift()
      if (!chunk) { this.utterance = null; done(); return }
      const utterance = new SpeechSynthesisUtterance(chunk)
      this.utterance = utterance
      utterance.lang = language
      if (voice) utterance.voice = voice
      utterance.pitch = 0.7
      utterance.rate = 0.95
      utterance.onend = () => { if (current()) { clearTimeout(this.timer); next() } }
      utterance.onerror = () => { if (current()) this.fail('playback') }
      // A blocked or stalled browser must not leave the call stuck forever.
      this.timer = setTimeout(() => { if (current()) this.fail('playback') }, 45_000)
      try { window.speechSynthesis.speak(utterance) } catch { this.fail('playback') }
    }
    next()
  }
}
