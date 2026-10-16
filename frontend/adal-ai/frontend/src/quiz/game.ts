import type { CharacterId } from '../experience/content'
import { questionBank, type QuizQuestion } from './content'

export const QUIZ_LENGTH = 10
export function rankLevel(score: number): number { return score >= 8 ? 2 : score >= 5 ? 1 : 0 }

function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

export function createRound(id: CharacterId): QuizQuestion[] {
  return shuffle(questionBank[id]).slice(0, QUIZ_LENGTH).map(question => {
    const order = shuffle(question.options.map((_, index) => index))
    return { ...question, options: order.map(index => question.options[index]), correct: order.indexOf(question.correct) }
  })
}

const storageKey = (id: CharacterId) => `adal.quiz.v1.${id}`
export function readBest(id: CharacterId): number | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey(id)) ?? 'null')
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= QUIZ_LENGTH ? value : null
  } catch { return null }
}

export function saveBest(id: CharacterId, score: number): { best: number; saved: boolean } {
  const best = Math.max(readBest(id) ?? 0, score)
  try {
    localStorage.setItem(storageKey(id), JSON.stringify(best))
    return { best, saved: true }
  } catch { return { best, saved: false } }
}
