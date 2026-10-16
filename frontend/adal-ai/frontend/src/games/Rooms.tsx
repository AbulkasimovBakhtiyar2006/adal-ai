import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/context'
import { GameError, joinUrl, nextStep, sendAnswer, startGame, type GameState } from './api'
import { gamesCopy, type GamesCopy } from './copy'
import { AnswerTiles, Avatar, Countdown, Leaderboard, Podium, QrCode } from './ui'
import { useGame, useRemaining } from './useGame'
import { SHAPES } from './avatars'

function useAction(c: GamesCopy) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async (action: () => Promise<unknown>, after?: () => Promise<unknown>) => {
    setBusy(true); setError(null)
    try { await action() } catch (err) {
      const code = err instanceof GameError ? err.code : 'generic'
      setError(c.errors[code as keyof GamesCopy['errors']] ?? c.errors.generic)
    } finally { setBusy(false); await after?.() }
  }
  return { error, busy, run }
}

function JoinPanel({ code, c }: { code: string; c: GamesCopy }) {
  const url = joinUrl(code)
  return <div className="game-join-panel">
    <QrCode value={url} label={`QR: ${url}`} />
    <div><p className="game-join-panel__label">{c.code}</p><p className="game-code" aria-label={`${c.code}: ${code.split('').join(' ')}`}>{code.slice(0, 3)} {code.slice(3)}</p>
      <p className="game-join-panel__url">{c.joinAt}: <strong>{location.host}</strong></p></div>
  </div>
}

function PlayerChips({ state }: { state: GameState }) {
  return <ul className="game-chips">{state.players.map(player => <li key={player.id}><Avatar id={player.avatar} size={30} />{player.name}</li>)}</ul>
}

function RoomError({ code, c, onExit }: { code: string; c: GamesCopy; onExit: () => void }) {
  const message = c.errors[code as keyof GamesCopy['errors']] ?? c.errors.generic
  return <div className="game-card game-center" role="alert"><h2>{message}</h2><button className="btn btn--primary" onClick={onExit}>{c.back}</button></div>
}

function useFocusOnChange(key: string) {
  const ref = useRef<HTMLHeadingElement>(null)
  useEffect(() => { ref.current?.focus({ preventScroll: true }) }, [key])
  return ref
}

/** The presenter's big screen: code + QR, the question, live counts and the podium. */
export function HostRoom({ code, token, onExit }: { code: string; token: string; onExit: () => void }) {
  const { lang } = useI18n()
  const c = gamesCopy[lang]
  const { state, error, receivedAt, refresh } = useGame(code, token)
  const remaining = useRemaining(state, receivedAt)
  const action = useAction(c)
  const heading = useFocusOnChange(`${state?.phase}:${state?.index}`)
  if (!state) return error && error !== 'network' ? <RoomError code={error} c={c} onExit={onExit} /> : <div className="game-card game-center" aria-busy="true">…</div>
  const q = state.question
  return <div className="game-stage">
    {error === 'network' && <p className="banner banner--offline" role="status">{c.errors.network}</p>}
    {state.phase === 'lobby' && <div className="game-card game-lobby">
      <h2 ref={heading} tabIndex={-1}>{c.lobbyHost}</h2><p className="game-muted">{c.lobbyHint}</p>
      <JoinPanel code={code} c={c} />
      <div className="game-lobby__players"><h3>{c.players} · {state.players.length}</h3>{state.players.length ? <PlayerChips state={state} /> : <p className="game-muted game-pulse">{c.waitingPlayers}</p>}</div>
      {action.error && <p className="game-error" role="alert">{action.error}</p>}
      <div className="game-actions"><button className="btn btn--primary game-big-btn" disabled={action.busy || state.players.length === 0} onClick={() => void action.run(() => startGame(code, token), refresh)}>{c.start} →</button></div>
    </div>}
    {(state.phase === 'question' || state.phase === 'reveal') && q && <div className="game-card game-question">
      <div className="game-question__bar"><span>{c.question} {state.index + 1} / {state.total}</span><span>{c.code}: <strong>{code}</strong></span><span>{c.answered}: {state.answeredCount} / {state.players.length}</span></div>
      <div className="game-question__head">{state.phase === 'question' && <Countdown ms={remaining} total={state.seconds} />}<h2 ref={heading} tabIndex={-1}>{q.text[lang]}</h2></div>
      <AnswerTiles question={q} lang={lang} reveal={state.phase === 'reveal'} />
      {state.phase === 'reveal' && <div className="game-reveal">
        {q.explanation && <p className="game-explanation"><strong>{c.rightAnswer}:</strong> {q.options[q.correct ?? 0][lang]}. {q.explanation[lang]}</p>}
        <div><h3>{c.leaders}</h3><Leaderboard players={state.players} c={c} /></div>
      </div>}
      {action.error && <p className="game-error" role="alert">{action.error}</p>}
      <div className="game-actions"><button className="btn btn--primary game-big-btn" disabled={action.busy} onClick={() => void action.run(() => nextStep(code, token), refresh)}>
        {state.phase === 'question' ? c.skip : state.index + 1 >= state.total ? c.results : c.next} →</button></div>
    </div>}
    {state.phase === 'finished' && <div className="game-card"><Podium state={state} c={c} /><div className="game-actions"><button className="btn btn--primary" onClick={onExit}>{c.again}</button></div></div>}
  </div>
}

/** A player's phone. For a duel the creator also holds the host token to start it. */
export function PlayerRoom({ code, token, hostToken, onExit }: { code: string; token: string; hostToken?: string | null; onExit: () => void }) {
  const { lang } = useI18n()
  const c = gamesCopy[lang]
  const { state, error, receivedAt, refresh } = useGame(code, token)
  const remaining = useRemaining(state, receivedAt)
  const action = useAction(c)
  const [picked, setPicked] = useState<{ index: number; choice: number } | null>(null)
  const heading = useFocusOnChange(`${state?.phase}:${state?.index}`)
  if (!state) return error && error !== 'network' ? <RoomError code={error} c={c} onExit={onExit} /> : <div className="game-card game-center" aria-busy="true">…</div>
  const me = state.you
  if (!me) return <RoomError code="game_not_found" c={c} onExit={onExit} />
  const q = state.question
  const duel = state.mode === 'duel'
  const choice = me.answer?.choice ?? (picked?.index === state.index ? picked.choice : null)
  const opponent = duel ? state.players.find(player => player.id !== me.id) : undefined
  return <div className="game-stage game-stage--player">
    {error === 'network' && <p className="banner banner--offline" role="status">{c.errors.network}</p>}
    <div className="game-me"><Avatar id={me.avatar} size={36} /><strong>{me.name}</strong><span>{c.score}: {me.score}</span>{state.phase !== 'lobby' && <span>{c.rank}: {me.rank}</span>}{me.streak > 1 && <span>🔥 {me.streak}</span>}</div>
    {state.phase === 'lobby' && <div className="game-card game-center">
      <h2 ref={heading} tabIndex={-1}>{c.youAreIn}</h2>
      {duel && hostToken ? <><p className="game-muted">{c.waitFriend}</p><JoinPanel code={code} c={c} /></> : <p className="game-muted game-pulse">{duel ? c.waitFriend : c.waitHost}</p>}
      {duel && <div className="game-versus">{state.players.map((player, i) => <div key={player.id}>{i > 0 && <span className="game-versus__vs">VS</span>}<Avatar id={player.avatar} size={64} /><strong>{player.name}</strong></div>)}{state.players.length < 2 && <div className="game-versus__empty"><span className="game-versus__vs">VS</span><span className="game-avatar game-pulse" style={{ width: 64, height: 64 }}>?</span></div>}</div>}
      {action.error && <p className="game-error" role="alert">{action.error}</p>}
      {duel && hostToken && <button className="btn btn--primary game-big-btn" disabled={action.busy || state.players.length < 2} onClick={() => void action.run(() => startGame(code, hostToken), refresh)}>{state.players.length < 2 ? c.needTwo : c.start}</button>}
    </div>}
    {state.phase === 'question' && q && <div className="game-card">
      <div className="game-question__bar"><span>{c.question} {state.index + 1} / {state.total}</span>{opponent && <span>{opponent.name}: {opponent.answered ? '✓' : '…'}</span>}</div>
      <div className="game-question__head"><Countdown ms={remaining} total={state.seconds} /><h2 ref={heading} tabIndex={-1}>{q.text[lang]}</h2></div>
      {choice === null ? <AnswerTiles question={q} lang={lang} disabled={action.busy} onPick={index => {
        setPicked({ index: state.index, choice: index })
        void action.run(() => sendAnswer(code, token, state.index, index), refresh)
      }} /> : <div className="game-wait" role="status"><span className={`answer-tile answer-tile--${choice} game-wait__shape`} aria-hidden="true">{SHAPES[choice]}</span><h3>{c.answerSent}</h3><p className="game-muted game-pulse">{c.waitOthers}</p></div>}
      {action.error && <p className="game-error" role="alert">{action.error}</p>}
    </div>}
    {state.phase === 'reveal' && q && <div className="game-card">
      <div className={`game-verdict game-verdict--${me.answer?.correct ? 'ok' : 'bad'}`} role="status">
        <h2 ref={heading} tabIndex={-1}>{me.answer ? (me.answer.correct ? c.correct : c.wrong) : c.timeUp}</h2>
        <p className="game-verdict__points">+{me.answer?.points ?? 0} {c.points}</p>
        <p>{c.rank}: {me.rank} / {state.players.length}{me.streak > 1 ? ` · ${c.streak}: 🔥 ${me.streak}` : ''}</p>
      </div>
      <p className="game-explanation"><strong>{c.rightAnswer}:</strong> {q.options[q.correct ?? 0][lang]}{q.explanation ? `. ${q.explanation[lang]}` : ''}</p>
      {duel ? <><Leaderboard players={state.players} meId={me.id} c={c} /><p className="game-muted">{state.index + 1 >= state.total ? c.results : c.nextSoon} · {Math.ceil(remaining / 1000)}</p></> : <p className="game-muted game-pulse">{c.waitHost}</p>}
    </div>}
    {state.phase === 'finished' && <div className="game-card"><Podium state={state} c={c} meId={me.id} /><div className="game-actions"><button className="btn btn--primary" onClick={onExit}>{c.again}</button></div></div>}
  </div>
}
