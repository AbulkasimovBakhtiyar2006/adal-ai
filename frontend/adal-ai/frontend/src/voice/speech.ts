import type { Lang } from '../api/types'

/** Prefer explicitly higher-quality voices, keeping the requested language. */
export function selectVoice(voices: SpeechSynthesisVoice[], lang: Lang): SpeechSynthesisVoice | undefined {
  const locale = lang === 'kk' ? 'kk-kz' : 'ru-ru'
  const normalize = (value: string) => value.toLowerCase().replace(/_/g, '-')
  const score = (voice: SpeechSynthesisVoice) => {
    const name = `${voice.name} ${voice.voiceURI}`
    const quality = /natural|neural|premium|enhanced|улучшенн/i.test(name) ? 100
      : /google/i.test(name) ? 60 : 0
    return quality + (normalize(voice.lang) === locale ? 10 : 0) + (voice.default ? 1 : 0)
  }
  return voices.filter(voice => normalize(voice.lang).split('-')[0] === lang)
    .sort((a, b) => score(b) - score(a))[0]
}

/** Keep complete sentences together; split unusually long ones at clause/word boundaries. */
export function speechChunks(text: string, maxLength = 240): string[] {
  const sentences: string[] = []
  let start = 0
  for (const match of text.matchAll(/[.!?…][»”"')\]]*(?:\s+|$)/g)) {
    const end = match.index + match[0].length
    sentences.push(text.slice(start, end))
    start = end
  }
  if (start < text.length) sentences.push(text.slice(start))
  const chunks: string[] = []
  let pending = ''
  for (let sentence of sentences) {
    if (pending && pending.length + sentence.length > maxLength) {
      chunks.push(pending)
      pending = ''
    }
    while (sentence.length > maxLength) {
      const prefix = sentence.slice(0, maxLength)
      const clauses = [...prefix.matchAll(/[,;:]\s+/g)]
      const clause = clauses.at(-1)
      const boundary = clause && clause.index > maxLength / 2
        ? clause.index + clause[0].length : prefix.lastIndexOf(' ') + 1
      const end = boundary || maxLength
      chunks.push(sentence.slice(0, end))
      sentence = sentence.slice(end)
    }
    pending += sentence
  }
  if (pending) chunks.push(pending)
  return chunks
}
