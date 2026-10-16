import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/context'
import { shuffledRound, type TopicId } from './bank'
import { gamesCopy } from './copy'
import { AnswerTiles, Countdown } from './ui'
import { BLITZ_SECONDS, readBlitzBest, saveBlitzBest } from './blitzScore'

/** One minute, as many questions as possible; a wrong answer only costs time. */
export function Blitz({ topic, onExit }: { topic: TopicId; onExit: () => void }) {
  const { lang } = useI18n()
  const c = gamesCopy[lang]
  const [deck, setDeck] = useState(() => shuffledRound(topic, 999))
  const [index, setIndex] = useState(0)
  const [score, setScore] = useState(0)
  const [streak, setStreak] = useState(0)
  const [flash, setFlash] = useState<{ choice: number; ok: boolean } | null>(null)
  const [endsAt, setEndsAt] = useState(() => performance.now() + BLITZ_SECONDS * 1000)
  const [now, setNow] = useState(() => performance.now())
  const [result, setResult] = useState<{ best: number; record: boolean } | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const scoreRef = useRef(0)
  const remaining = Math.max(0, endsAt - now)

  useEffect(() => {
    if (result) return
    const timer = setInterval(() => {
      const time = performance.now()
      setNow(time)
      if (time < endsAt) return
      clearInterval(timer)
      const previous = readBlitzBest(topic)
      if (scoreRef.current > previous) saveBlitzBest(topic, scoreRef.current)
      setResult({ best: Math.max(previous, scoreRef.current), record: scoreRef.current > previous })
    }, 200)
    return () => clearInterval(timer)
  }, [result, endsAt, topic])
  useEffect(() => { heading.current?.focus({ preventScroll: true }) }, [index, result])

  const question = deck[index % deck.length]
  const pick = (choice: number) => {
    if (flash || result) return
    const ok = choice === question.correct
    setFlash({ choice, ok })
    if (ok) { scoreRef.current += 1; setScore(scoreRef.current); setStreak(value => value + 1) } else setStreak(0)
    setTimeout(() => {
      setFlash(null)
      // Reshuffle after the deck runs out so a long streak never repeats in order.
      if ((index + 1) % deck.length === 0) setDeck(shuffledRound(topic, 999))
      setIndex(value => value + 1)
    }, ok ? 450 : 900)
  }
  const restart = () => {
    setDeck(shuffledRound(topic, 999)); setIndex(0); setScore(0); scoreRef.current = 0; setStreak(0); setFlash(null); setResult(null)
    const start = performance.now(); setNow(start); setEndsAt(start + BLITZ_SECONDS * 1000)
  }

  if (result) return <div className="game-card game-center game-blitz-result">
    <p className="eyebrow">{c.blitzTitle} · {c.topics[topic]}</p>
    <h2 ref={heading} tabIndex={-1}>{c.blitzOver}</h2>
    <p className="game-blitz-result__score">{score}</p><p>{c.blitzScore}</p>
    <p className="game-podium__me" role="status">{result.record ? `🏆 ${c.newRecord}` : `${c.blitzBest}: ${result.best}`}</p>
    <div className="game-actions"><button className="btn btn--primary" onClick={restart}>{c.play}</button><button className="btn btn--secondary" onClick={onExit}>{c.back}</button></div>
  </div>
  return <div className="game-card">
    <div className="game-question__bar"><span>{c.blitzTitle}</span><span>{c.blitzScore}: <strong>{score}</strong></span>{streak > 1 && <span>🔥 {streak}</span>}</div>
    <div className="game-question__head"><Countdown ms={remaining} total={BLITZ_SECONDS} /><h2 ref={heading} tabIndex={-1}>{question.text[lang]}</h2></div>
    <AnswerTiles question={question} lang={lang} onPick={pick} disabled={!!flash} picked={flash?.choice} reveal={!!flash && !flash.ok} />
    <p className="game-muted" role="status">{flash ? (flash.ok ? `✓ ${c.correct}` : `✕ ${c.wrong}`) : ''}</p>
  </div>
}
