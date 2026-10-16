import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ApiError, createConversation, deleteSession, getConfig, getConversations, getHistory } from './api/client'
import type { Conversation, ErrorCode, PublicConfig } from './api/types'
import { useChat } from './chat/useChat'
import { Composer } from './components/Composer'
import { ConfirmDialog } from './components/ConfirmDialog'
import { Header } from './components/Header'
import { PhoneIcon, PlusIcon } from './components/Icons'
import { VoiceCall } from './components/VoiceCall'
import { useVoice } from './voice/useVoice'
import { TurnView } from './components/TurnView'
import { Examples, Welcome } from './components/Welcome'
import { useI18n } from './i18n/context'

type Boot = { phase: 'loading' } | { phase: 'ready'; config: PublicConfig } | { phase: 'error'; code: ErrorCode }
function subscribeOnline(callback: () => void) {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => { window.removeEventListener('online', callback); window.removeEventListener('offline', callback) }
}

export default function App() {
  const { t, lang } = useI18n()
  const [boot, setBoot] = useState<Boot>({ phase: 'loading' })
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string>()
  const [view, setView] = useState<'home' | 'chat'>('home')
  const [switching, setSwitching] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [actionFailed, setActionFailed] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [voiceOpen, setVoiceOpen] = useState(false)
  const chat = useChat(lang, activeId)
  const voice = useVoice(lang, boot.phase === 'ready' ? boot.config.maxMessageChars : 2000, `${view}:${activeId ?? ''}`)
  const { loadHistory, clear } = chat
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const operationRef = useRef(false)
  // Drafts stay in memory while switching chats; message history lives on the server.
  const draftsRef = useRef<Record<string, string>>({})

  useEffect(() => {
    let active = true
    void Promise.all([getConfig(), getConversations()]).then(([config, items]) => {
      if (!active) return
      setConversations(items)
      setBoot({ phase: 'ready', config })
    }).catch(err => {
      if (active) setBoot({ phase: 'error', code: err instanceof ApiError ? err.code : 'INTERNAL' })
    })
    return () => { active = false }
  }, [loadAttempt])

  const lastTurn = chat.turns.at(-1)
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [chat.turns.length, lastTurn?.phase, activeId])
  useEffect(() => {
    if (view === 'chat' && !switching) inputRef.current?.focus()
  }, [view, switching, activeId])

  const ready = boot.phase === 'ready'
  const locked = chat.busy || switching || !ready
  const refreshList = async () => {
    try { setConversations(await getConversations()) } catch { setActionFailed(true) }
  }
  const startChat = async (example = '') => {
    if (locked || operationRef.current) return
    if (activeId && chat.turns.length === 0 && !draft) {
      setDraft(example); setView('chat'); setSidebarOpen(false)
      inputRef.current?.focus()
      return
    }
    operationRef.current = true
    setSwitching(true)
    setActionFailed(false)
    try {
      const item = await createConversation()
      if (activeId) draftsRef.current[activeId] = draft
      setConversations(items => [item, ...items])
      setActiveId(item.id)
      clear()
      setDraft(example)
      setView('chat')
      setSidebarOpen(false)
    } catch { setActionFailed(true) }
    finally { setSwitching(false); operationRef.current = false }
  }
  const openChat = async (id: string) => {
    if (locked || operationRef.current) return
    if (id === activeId) { setView('chat'); setSidebarOpen(false); return }
    operationRef.current = true
    setSwitching(true)
    setActionFailed(false)
    try {
      const history = await getHistory(id)
      if (activeId) draftsRef.current[activeId] = draft
      loadHistory(history)
      setActiveId(id)
      setDraft(draftsRef.current[id] ?? '')
      setView('chat')
      setSidebarOpen(false)
    } catch { setActionFailed(true) }
    finally { setSwitching(false); operationRef.current = false }
  }
  const submit = () => {
    const question = draft.trim()
    if (!question || locked || !activeId) return
    setDraft('')
    draftsRef.current[activeId] = ''
    void chat.send(question).then(refreshList)
  }
  const pickExample = (text: string) => { setDraft(text); inputRef.current?.focus() }
  const cancelDelete = useCallback(() => setConfirmDelete(false), [])
  const removeData = async () => {
    setConfirmDelete(false)
    setSwitching(true)
    try {
      await deleteSession()
      // Establish a fresh cookie before the next create-chat request.
      setConversations(await getConversations())
      clear(); setActiveId(undefined); setDraft(''); setView('home')
      draftsRef.current = {}
      setActionFailed(false)
    } catch { setActionFailed(true) }
    finally { setSwitching(false) }
  }
  const activeChat = conversations.find(item => item.id === activeId)
  return <div className={`app workspace ${sidebarOpen ? 'workspace--history-open' : ''}`}>
    <a className="skip-link" href="#workspace-main">{view === 'home' ? t.home : t.inputLabel}</a>
    <div className="top"><Header onHome={() => setView('home')} disabled={locked}
      onToggleHistory={() => setSidebarOpen(open => !open)} historyOpen={sidebarOpen}
      onDeleteData={() => setConfirmDelete(true)} /></div>
    <aside className="chat-sidebar" id="chat-sidebar" aria-label={t.chatHistory}>
      <button className="btn btn--primary sidebar-new" disabled={locked} onClick={() => void startChat()}><PlusIcon />{t.newChat}</button>
      <button className={`sidebar-home ${view === 'home' ? 'is-active' : ''}`} disabled={locked} onClick={() => { setView('home'); setSidebarOpen(false) }}>{t.home}</button>
      <div className="sidebar-heading"><h2>{t.chatHistory}</h2><span>{conversations.length}</span></div>
      <nav className="chat-list" aria-label={t.chatHistory}>
        {conversations.length === 0 && <p className="sidebar-empty">{t.noChats}</p>}
        {conversations.map(item => <button key={item.id} disabled={locked}
          aria-current={view === 'chat' && activeId === item.id ? 'page' : undefined}
          title={item.title || t.newChat} onClick={() => void openChat(item.id)}>
          <span>{item.title || t.newChat}</span>
          <time dateTime={new Date(item.updatedAt * 1000).toISOString()}>{new Date(item.updatedAt * 1000).toLocaleDateString(lang === 'kk' ? 'kk-KZ' : 'ru-RU', { day: '2-digit', month: '2-digit' })}</time>
        </button>)}
      </nav>
      <div className="sidebar-footer"><p>{t.historyHint}</p><a href="/admin">{t.management}<span aria-hidden="true">↗</span></a></div>
    </aside>
    <main className="workspace-main" id="workspace-main" tabIndex={-1} aria-busy={switching}>
      {!online && <div className="banner banner--offline" role="status">{t.offline}</div>}
      {actionFailed && <div className="banner banner--error" role="alert">{t.actionFailed}<button className="btn btn--ghost" onClick={() => void refreshList()}>{t.reload}</button></div>}
      {boot.phase === 'loading' && <p className="thread__status">{t.loadingHistory}</p>}
      {boot.phase === 'error' && <div className="answer answer--error" role="alert"><h2>{t.configLoadError}</h2><p>{t.errors[boot.code]}</p><button className="btn btn--secondary" onClick={() => { setBoot({ phase: 'loading' }); setLoadAttempt(n => n + 1) }}>{t.reload}</button></div>}
      {ready && view === 'home' && <div className="home-scroll"><Welcome disabled={locked} onStart={() => void startChat()} onPickExample={text => void startChat(text)} /></div>}
      {ready && view === 'chat' && <>
        <div className="chat-heading"><h1>{activeChat?.title || t.newChat}</h1><button className="btn btn--secondary voice-launch" disabled={locked || !online} onClick={() => { voice.controller.end(); setVoiceOpen(true) }}><PhoneIcon />{t.voice.title}</button></div>
        <div className="chat-scroll" ref={scrollRef}>
          <div className="thread">
            {chat.turns.length === 0 ? <section className="empty-chat"><h2>{t.emptyChatTitle}</h2><p>{t.emptyChatText}</p><Examples onPick={pickExample} disabled={locked} /></section> :
              <ol className="turns" aria-live="polite">{chat.turns.map(turn => <TurnView key={turn.id} turn={turn} canRetry={turn.id === lastTurn?.id && !locked}
                canSpeak={voice.controller.canSpeak} speaking={voice.state.speakingId === turn.id}
                onSpeak={() => { if (turn.reply) voice.controller.read(turn.id, turn.reply.answer) }}
                onRetry={id => { void chat.retry(id)?.then(refreshList) }} />)}</ol>}
          </div>
        </div>
        <footer className="composer-area"><Composer value={draft} onChange={setDraft} onSubmit={submit} busy={chat.busy} disabled={switching}
          maxChars={boot.config.maxMessageChars} inputRef={inputRef} />
          {!voiceOpen && voice.state.error && <p className="voice-error" role="alert">{t.voice.errors[voice.state.error]}</p>}
        </footer>
      </>}
    </main>
    {confirmDelete && <ConfirmDialog title={t.deleteDataConfirmTitle} text={t.deleteDataConfirmText} confirmLabel={t.deleteDataConfirm} onConfirm={() => void removeData()} onCancel={cancelDelete} />}
    {voiceOpen && <VoiceCall controller={voice.controller} state={voice.state} busy={locked || !online}
      onClose={() => { voice.controller.end(); setVoiceOpen(false) }}
      onQuestion={async question => {
        const reply = await chat.send(question)
        void refreshList()
        return reply?.answer
      }} />}
  </div>
}
