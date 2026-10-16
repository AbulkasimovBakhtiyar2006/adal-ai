import type { TopicId } from './bank'

export const BLITZ_SECONDS = 60
const bestKey = (topic: TopicId) => `adal.blitz.v1.${topic}`
export function readBlitzBest(topic: TopicId): number {
  try { const value = Number(localStorage.getItem(bestKey(topic))); return Number.isInteger(value) && value > 0 ? value : 0 } catch { return 0 }
}
export function saveBlitzBest(topic: TopicId, score: number) {
  try { localStorage.setItem(bestKey(topic), String(score)) } catch { /* the record is just not kept */ }
}
