import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ApiError, clearHistory, deleteSession, getConfig, getHistory } from './api/client'
import type { ErrorCode, HistoryTurn, PublicConfig } from './api/types'
import { useChat } from './chat/useChat'
import { Composer } from './components/Composer'
import { ConfirmDialog } from './components/ConfirmDialog'
import { Header } from './components/Header'
import { TurnView } from './components/TurnView'
import { Welcome } from './components/Welcome'
import { useI18n } from './i18n/context'

type Boot = { phase: 'loading' } | { phase: 'ready'; config: PublicConfig } | { phase: 'error'; code: ErrorCode }
type PendingAction = 'newChat' | 'deleteData' | null

async function fetchSession(): Promise<{ next: Boot; turns: HistoryTurn[] }> {
  try {
    const [config, turns] = await Promise.all([getConfig(), getHistory()])
    return { next: { phase: 'ready', config }, turns }
  } catch (err) {
    return { next: { phase: 'error', code: err instanceof ApiError ? err.code : 'INTERNAL' }, turns: [] }
  }
}

function subscribeOnline(callback: () => void) {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}

export default function App() {
  const { t, lang } = useI18n()
  const chat = useChat(lang)
  const { loadHistory, clear } = chat
  const [boot, setBoot] = useState<Boot>({ phase: 'loading' })
  const [draft, setDraft] = useState('')
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [actionFailed, setActionFailed] = useState(false)
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Настройки и история загружаются с сервера. История в браузере не хранится.
  const [loadAttempt, setLoadAttempt] = useState(0)
  useEffect(() => {
    let active = true
    void fetchSession().then(({ next, turns }) => {
      if (!active) return
      loadHistory(turns)
      setBoot(next)
    })
    return () => {
      active = false
    }
  }, [loadAttempt, loadHistory])

  // При новом ходе и смене его состояния прокручиваем к концу страницы:
  // поле ввода закреплено внизу, поэтому последняя карточка оказывается прямо над ним.
  const lastTurn = chat.turns.at(-1)
  useEffect(() => {
    if (chat.turns.length > 0) window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' })
  }, [chat.turns.length, lastTurn?.phase])

  const ready = boot.phase === 'ready'
  const home = ready && chat.turns.length === 0
  const submit = () => {
    const question = draft.trim()
    if (!question || chat.busy || !ready) return
    setDraft('')
    chat.send(question)
  }

  const pickExample = (text: string) => {
    setDraft(text)
    inputRef.current?.focus()
  }

  const cancelAction = useCallback(() => setPendingAction(null), [])
  const confirmAction = async () => {
    const action = pendingAction
    setPendingAction(null)
    try {
      await (action === 'deleteData' ? deleteSession() : clearHistory())
      clear()
      setDraft('')
      setActionFailed(false)
    } catch {
      setActionFailed(true)
    }
  }

  const composer = <Composer
    value={draft}
    onChange={setDraft}
    onSubmit={submit}
    busy={chat.busy}
    disabled={!ready}
    maxChars={ready ? boot.config.maxMessageChars : 2000}
    inputRef={inputRef}
  />

  return (
    <div className={`app ${home ? 'app--home' : 'app--chat'}`}>
      <a className="skip-link" href="#composer-input">
        {t.inputLabel}
      </a>
      <div className="top">
        <Header
          canStartNew={ready && chat.turns.length > 0 && !chat.busy}
          onNewChat={() => setPendingAction('newChat')}
          onDeleteData={() => setPendingAction('deleteData')}
        />
        {!online && (
          <div className="banner banner--offline" role="status">
            {t.offline}
          </div>
        )}
        {actionFailed && (
          <div className="banner banner--error" role="alert">
            {t.actionFailed}
          </div>
        )}
      </div>

      <main className="main">
        <div className="thread">
          {boot.phase === 'loading' && <p className="thread__status">{t.loadingHistory}</p>}

          {boot.phase === 'error' && (
            <div className="answer answer--error" role="alert">
              <p className="state-note__title">{t.configLoadError}</p>
              <p className="answer__meta">{t.errors[boot.code]}</p>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => {
                  setBoot({ phase: 'loading' })
                  setLoadAttempt((attempt) => attempt + 1)
                }}
              >
                {t.reload}
              </button>
            </div>
          )}

          {home && <Welcome onPickExample={pickExample}>{composer}</Welcome>}

          {ready && chat.turns.length > 0 && (
            <ol className="turns" aria-live="polite">
              {chat.turns.map((turn) => (
                <TurnView
                  key={turn.id}
                  turn={turn}
                  canRetry={turn.id === lastTurn?.id && !chat.busy}
                  onRetry={chat.retry}
                />
              ))}
            </ol>
          )}
        </div>
      </main>

      {!home && boot.phase !== 'loading' && <footer className="composer-area">{composer}</footer>}

      {pendingAction && (
        <ConfirmDialog
          title={pendingAction === 'newChat' ? t.newChatConfirmTitle : t.deleteDataConfirmTitle}
          text={pendingAction === 'newChat' ? t.newChatConfirmText : t.deleteDataConfirmText}
          confirmLabel={pendingAction === 'newChat' ? t.newChatConfirm : t.deleteDataConfirm}
          onConfirm={() => void confirmAction()}
          onCancel={cancelAction}
        />
      )}
    </div>
  )
}
