import { useState, type FormEvent } from 'react'
import { useI18n } from '../i18n/context'
import { createGame, GameError, isGameCode, joinGame, savedHostToken, savedToken } from './api'
import { shuffledRound, topicIds, topicPool, type TopicId } from './bank'
import { Blitz } from './Blitz'
import { readBlitzBest } from './blitzScore'
import { gamesCopy, type GamesCopy } from './copy'
import { HostRoom, PlayerRoom } from './Rooms'
import { Avatar } from './ui'
import { avatarIds } from './avatars'

export type GameEntry = 'live' | 'duel' | 'blitz' | 'join'
type Screen =
  | { kind: 'hub' }
  | { kind: 'setup'; mode: 'live' | 'duel' | 'blitz' }
  | { kind: 'join'; code: string }
  | { kind: 'host'; code: string; token: string }
  | { kind: 'play'; code: string; token: string; hostToken?: string | null }
  | { kind: 'blitz'; topic: TopicId }

function initialScreen(code?: string): Screen {
  if (!code || !isGameCode(code)) return { kind: 'hub' }
  const host = savedHostToken(code)
  const player = savedToken(code)
  // Reloading the page returns to a game this tab already joined or hosts.
  if (player) return { kind: 'play', code, token: player, hostToken: host }
  if (host) return { kind: 'host', code, token: host }
  return { kind: 'join', code }
}

const errorText = (c: GamesCopy, err: unknown) => c.errors[(err instanceof GameError ? err.code : 'generic') as keyof GamesCopy['errors']] ?? c.errors.generic

function Identity({ name, avatar, onName, onAvatar, c }: { name: string; avatar: string; onName: (v: string) => void; onAvatar: (v: string) => void; c: GamesCopy }) {
  return <>
    <label className="game-field"><span>{c.name}</span><input value={name} onChange={event => onName(event.target.value)} maxLength={20} placeholder={c.namePlaceholder} autoComplete="nickname" required /></label>
    <fieldset className="game-field game-avatars"><legend>{c.avatar}</legend>{avatarIds.map(id => <label key={id} className="game-avatars__option">
      <input type="radio" name="game-avatar" value={id} checked={avatar === id} onChange={() => onAvatar(id)} /><Avatar id={id} size={44} /><span className="visually-hidden">{id}</span>
    </label>)}</fieldset>
  </>
}

function Setup({ mode, onBack, onReady }: { mode: 'live' | 'duel' | 'blitz'; onBack: () => void; onReady: (screen: Screen) => void }) {
  const { lang } = useI18n()
  const c = gamesCopy[lang]
  const [topic, setTopic] = useState<TopicId>('kazakhstan')
  const [count, setCount] = useState(10)
  const [seconds, setSeconds] = useState(20)
  const [name, setName] = useState('')
  const [avatar, setAvatar] = useState('eagle')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const available = topicPool(topic).length
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (mode === 'blitz') { onReady({ kind: 'blitz', topic }); return }
    if (mode === 'duel' && !name.trim()) return
    setBusy(true); setError(null)
    try {
      const title = c.topics[topic]
      const game = await createGame(mode, seconds, shuffledRound(topic, Math.min(count, available)), title)
      if (mode === 'live') onReady({ kind: 'host', code: game.code, token: game.token })
      else onReady({ kind: 'play', code: game.code, token: await joinGame(game.code, name.trim(), avatar), hostToken: game.token })
    } catch (err) { setError(errorText(c, err)) } finally { setBusy(false) }
  }
  const title = { live: c.liveTitle, duel: c.duelTitle, blitz: c.blitzTitle }[mode]
  return <form className="game-card game-setup" onSubmit={event => void submit(event)}>
    <button type="button" className="text-button" onClick={onBack}>← {c.back}</button>
    <h2>{title}</h2>
    <fieldset className="game-field game-pills"><legend>{c.topic}</legend>{topicIds.map(id => <label key={id}><input type="radio" name="topic" checked={topic === id} onChange={() => setTopic(id)} /><span>{c.topics[id]}{mode === 'blitz' && readBlitzBest(id) > 0 && <small> · 🏆 {readBlitzBest(id)}</small>}</span></label>)}</fieldset>
    {mode !== 'blitz' && <>
      <fieldset className="game-field game-pills"><legend>{c.count}</legend>{[5, 10, 15].map(n => <label key={n}><input type="radio" name="count" checked={count === n} onChange={() => setCount(n)} /><span>{Math.min(n, available)}</span></label>)}</fieldset>
      <fieldset className="game-field game-pills"><legend>{c.timer}</legend>{[10, 20, 30].map(n => <label key={n}><input type="radio" name="seconds" checked={seconds === n} onChange={() => setSeconds(n)} /><span>{n} {c.seconds}</span></label>)}</fieldset>
    </>}
    {mode === 'duel' && <Identity name={name} avatar={avatar} onName={setName} onAvatar={setAvatar} c={c} />}
    {error && <p className="game-error" role="alert">{error}</p>}
    <button className="btn btn--primary game-big-btn" type="submit" disabled={busy || (mode === 'duel' && !name.trim())}>{mode === 'blitz' ? c.blitzStart : c.create} →</button>
  </form>
}

function Join({ initialCode, onBack, onReady }: { initialCode: string; onBack: () => void; onReady: (screen: Screen) => void }) {
  const { lang } = useI18n()
  const c = gamesCopy[lang]
  const [code, setCode] = useState(initialCode)
  const [name, setName] = useState('')
  const [avatar, setAvatar] = useState('eagle')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!isGameCode(code) || !name.trim()) return
    setBusy(true); setError(null)
    try { onReady({ kind: 'play', code, token: await joinGame(code, name.trim(), avatar) }) }
    catch (err) { setError(errorText(c, err)) } finally { setBusy(false) }
  }
  return <form className="game-card game-setup" onSubmit={event => void submit(event)}>
    <button type="button" className="text-button" onClick={onBack}>← {c.back}</button>
    <h2>{c.joinTitle}</h2><p className="game-muted">{c.joinText}</p>
    <label className="game-field"><span>{c.code}</span><input className="game-code-input" value={code} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder={c.codePlaceholder}
      onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required /></label>
    <Identity name={name} avatar={avatar} onName={setName} onAvatar={setAvatar} c={c} />
    {error && <p className="game-error" role="alert">{error}</p>}
    <button className="btn btn--primary game-big-btn" type="submit" disabled={busy || !isGameCode(code) || !name.trim()}>{c.join} →</button>
  </form>
}

const modeCards = (c: GamesCopy) => [
  { id: 'live' as const, icon: '🎤', title: c.liveTitle, text: c.liveText },
  { id: 'duel' as const, icon: '⚔️', title: c.duelTitle, text: c.duelText },
  { id: 'blitz' as const, icon: '⚡', title: c.blitzTitle, text: c.blitzText },
  { id: 'join' as const, icon: '🔢', title: c.joinTitle, text: c.joinText },
]

/** Home-page teaser that opens the games view. */
export function GamesPromo({ onOpen }: { onOpen: (entry: GameEntry) => void }) {
  const { lang } = useI18n()
  const c = gamesCopy[lang]
  return <section id="games" className="portal-section games-promo" aria-labelledby="games-promo-title" tabIndex={-1}>
    <div className="section-heading"><div><p className="eyebrow"><span />{c.eyebrow}</p><h2 id="games-promo-title">{c.title}</h2></div></div>
    <div className="game-modes">{modeCards(c).map(card => <button key={card.id} className={`game-mode game-mode--${card.id}`} onClick={() => onOpen(card.id)}>
      <span className="game-mode__icon" aria-hidden="true">{card.icon}</span><h3>{card.title}</h3><p>{card.text}</p><span className="game-mode__go">{card.id === 'join' ? c.join : c.play} →</span>
    </button>)}</div>
  </section>
}

export function GamesHub({ entry, initialCode, onHome }: { entry?: GameEntry; initialCode?: string; onHome: () => void }) {
  const { lang } = useI18n()
  const c = gamesCopy[lang]
  const [screen, setScreen] = useState<Screen>(() => {
    const restored = initialScreen(initialCode)
    if (restored.kind !== 'hub' || !entry) return restored
    return entry === 'join' ? { kind: 'join', code: '' } : { kind: 'setup', mode: entry }
  })
  const hub = () => {
    setScreen({ kind: 'hub' })
    if (location.search) history.replaceState(null, '', location.pathname)
  }
  const go = (next: Screen) => {
    setScreen(next)
    if (next.kind === 'host' || next.kind === 'play') history.replaceState(null, '', `/?game=${next.code}`)
    requestAnimationFrame(() => document.querySelector('.games-scroll')?.scrollTo({ top: 0 }))
  }
  return <div className="games-scroll"><div className={`games ${screen.kind === 'host' ? 'games--stage' : ''}`}>
    {screen.kind === 'hub' && <>
      <div className="games-intro"><p className="eyebrow"><span />{c.eyebrow}</p><h1>{c.title}</h1><p>{c.intro}</p></div>
      <div className="game-modes">{modeCards(c).map(card => <button key={card.id} className={`game-mode game-mode--${card.id}`} onClick={() => go(card.id === 'join' ? { kind: 'join', code: '' } : { kind: 'setup', mode: card.id })}>
        <span className="game-mode__icon" aria-hidden="true">{card.icon}</span><h2>{card.title}</h2><p>{card.text}</p><span className="game-mode__go">{card.id === 'join' ? c.join : c.play} →</span>
      </button>)}</div>
      <button className="text-button games-home" onClick={onHome}>← {c.back}</button>
    </>}
    {screen.kind === 'setup' && <Setup mode={screen.mode} onBack={hub} onReady={go} />}
    {screen.kind === 'join' && <Join initialCode={screen.code} onBack={hub} onReady={go} />}
    {screen.kind === 'host' && <HostRoom key={screen.code} code={screen.code} token={screen.token} onExit={hub} />}
    {screen.kind === 'play' && <PlayerRoom key={screen.code} code={screen.code} token={screen.token} hostToken={screen.hostToken} onExit={hub} />}
    {screen.kind === 'blitz' && <Blitz key={screen.topic} topic={screen.topic} onExit={hub} />}
  </div></div>
}
