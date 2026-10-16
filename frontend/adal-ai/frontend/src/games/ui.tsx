import qrcode from 'qrcode-generator'
import { useMemo } from 'react'
import type { Lang } from '../api/types'
import type { GamePlayer, GameState } from './api'
import { AVATARS, SHAPES } from './avatars'
import type { GamesCopy } from './copy'

export function Avatar({ id, size = 40 }: { id: string; size?: number }) {
  const emoji = AVATARS[id]
  return emoji === undefined || emoji
    ? <span className="game-avatar" style={{ width: size, height: size, fontSize: size * .58 }} aria-hidden="true">{emoji || '🙂'}</span>
    : <img className="game-avatar" src={`/characters/${id}.jpg`} alt="" width={size} height={size} />
}

export function QrCode({ value, label }: { value: string; label: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(value)
    qr.make()
    const count = qr.getModuleCount()
    let d = ''
    for (let row = 0; row < count; row++) for (let col = 0; col < count; col++) if (qr.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`
    return { size: count, path: d }
  }, [value])
  return <svg className="game-qr" viewBox={`-3 -3 ${size + 6} ${size + 6}`} role="img" aria-label={label} shapeRendering="crispEdges">
    <rect x={-3} y={-3} width={size + 6} height={size + 6} fill="#fff" /><path d={path} fill="#111" />
  </svg>
}

export function Countdown({ ms, total }: { ms: number; total: number }) {
  const seconds = Math.ceil(ms / 1000)
  const share = total > 0 ? Math.min(1, ms / (total * 1000)) : 0
  return <div className={`game-timer ${seconds <= 5 ? 'game-timer--low' : ''}`} role="timer" aria-label={`${seconds}`}>
    <svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="19" className="game-timer__track" /><circle cx="22" cy="22" r="19" className="game-timer__bar" strokeDasharray={`${share * 119.4} 119.4`} /></svg>
    <span>{seconds}</span>
  </div>
}

export function AnswerTiles({ question, lang, onPick, picked, disabled = false, reveal = false }: {
  question: NonNullable<GameState['question']>; lang: Lang; onPick?: (index: number) => void; picked?: number | null; disabled?: boolean; reveal?: boolean
}) {
  const max = Math.max(1, ...(question.counts ?? [0]))
  return <div className="answer-tiles">{question.options.map((option, index) => {
    const correct = reveal && index === question.correct
    const dimmed = reveal && !correct
    const content = <><span className="answer-tile__shape" aria-hidden="true">{SHAPES[index]}</span><span className="answer-tile__text">{option[lang]}</span>
      {reveal && question.counts && <span className="answer-tile__count"><i style={{ width: `${(question.counts[index] / max) * 100}%` }} />{question.counts[index]}</span>}
      {correct && <strong className="answer-tile__mark" aria-label="✓">✓</strong>}</>
    const className = `answer-tile answer-tile--${index} ${dimmed ? 'answer-tile--dim' : ''} ${picked === index ? 'answer-tile--picked' : ''}`
    return onPick
      ? <button key={index} className={className} disabled={disabled} onClick={() => onPick(index)}>{content}</button>
      : <div key={index} className={className}>{content}</div>
  })}</div>
}

export function Leaderboard({ players, limit = 5, meId, c }: { players: GamePlayer[]; limit?: number; meId?: string; c: GamesCopy }) {
  return <ol className="game-leaders">{players.slice(0, limit).map(player => <li key={player.id} className={player.id === meId ? 'game-leaders__me' : ''}>
    <span className="game-leaders__rank">{player.rank}</span><Avatar id={player.avatar} size={34} />
    <span className="game-leaders__name">{player.name}{player.id === meId && <small> · {c.you}</small>}</span>
    <strong>{player.score}</strong>
  </li>)}</ol>
}

export function Podium({ state, c, meId }: { state: GameState; c: GamesCopy; meId?: string }) {
  const top = state.players.slice(0, 3)
  const draw = state.players.length > 1 && state.players[1].rank === 1
  const winners = state.players.filter(player => player.rank === 1)
  const me = state.players.find(player => player.id === meId)
  const order = [top[1], top[0], top[2]]
  return <section className="game-podium" aria-labelledby="podium-title">
    <div className="game-confetti" aria-hidden="true">{Array.from({ length: 24 }, (_, i) => <i key={i} style={{ left: `${(i * 41) % 100}%`, animationDelay: `${(i % 8) * .25}s` }} />)}</div>
    <p className="eyebrow">{c.podium}</p>
    <h2 id="podium-title" tabIndex={-1}>{winners.length === 0 ? c.results : draw ? c.draw : `${c.winner}: ${winners[0].name} 🏆`}</h2>
    {me && <p className="game-podium__me" role="status">{me.rank === 1 && !draw ? c.youWon : `${c.yourPlace}: ${me.rank} · ${me.score} ${c.points}`}</p>}
    <div className="game-podium__steps">{order.map((player, slot) => player && <div key={player.id} className={`game-podium__step game-podium__step--${[2, 1, 3][slot]}`}>
      {player.rank === 1 && <span className="game-podium__crown" aria-hidden="true">👑</span>}
      <Avatar id={player.avatar} size={slot === 1 ? 76 : 60} /><strong>{player.name}</strong><span className="game-podium__score">{player.score} {c.points}</span>
      <div className="game-podium__block">{player.rank}</div>
    </div>)}</div>
    {state.players.length > 3 && <details className="game-podium__all"><summary>{c.fullTable}</summary><Leaderboard players={state.players} limit={60} meId={meId} c={c} /></details>}
  </section>
}
