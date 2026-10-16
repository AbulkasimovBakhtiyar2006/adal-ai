import type { ChatAttachment } from './api/types'
import { accountCopy } from './account/copy'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ApiError, createConversation, deleteSession, getConfig, getConversations, getHistory, signInWithGoogle, signOut } from './api/client'
import type { Conversation, ErrorCode, PublicConfig } from './api/types'
import { useChat } from './chat/useChat'
import { Composer } from './components/Composer'
import { ConfirmDialog } from './components/ConfirmDialog'
import { Header } from './components/Header'
import { BookIcon, ChatIcon, HomeIcon, PhoneIcon, PlusIcon } from './components/Icons'
import { VoiceCall } from './components/VoiceCall'
import { useVoice } from './voice/useVoice'
import { TurnView } from './components/TurnView'
import { Examples, Welcome } from './components/Welcome'
import { useAppearance } from './experience/useAppearance'
import type { CharacterId } from './experience/content'
import { AppearanceSettings } from './components/AppearanceSettings'
import { CharacterProfile, CharacterCompanion } from './components/Characters'
import { useI18n } from './i18n/context'
import { GamesHub, type GameEntry } from './games/GamesHub'
import { KnowledgeBase } from './knowledge/KnowledgeBase'

const linkedGame = new URLSearchParams(location.search).get('game') ?? undefined

function mergeConversations(current: Conversation[], incoming: Conversation[]): Conversation[] {
  const items = new Map(current.map(item => [item.id, item]))
  for (const item of incoming) {
    const previous = items.get(item.id)
    if (!previous || item.updatedAt >= previous.updatedAt) items.set(item.id, item)
  }
  return [...items.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

type Boot = { phase: 'loading' } | { phase: 'ready'; config: PublicConfig } | { phase: 'error'; code: ErrorCode }
function subscribeOnline(callback: () => void) {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => { window.removeEventListener('online', callback); window.removeEventListener('offline', callback) }
}

export default function App() {
  const { t, lang } = useI18n()
  const appearance = useAppearance()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [profile, setProfile] = useState<CharacterId | null>(null)
  const [boot, setBoot] = useState<Boot>({ phase: 'loading' })
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyFailed, setHistoryFailed] = useState(false)
  const [activeId, setActiveId] = useState<string>()
  const [view, setView] = useState<'home' | 'chat' | 'games' | 'knowledge'>(linkedGame ? 'games' : 'home')
  const [games, setGames] = useState<{ entry?: GameEntry; code?: string; key: number }>({ code: linkedGame, key: 0 })
  const [switching, setSwitching] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [actionFailed, setActionFailed] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [voiceOpen, setVoiceOpen] = useState(false)
  const chat = useChat(lang, activeId)
  const voice = useVoice(lang, boot.phase === 'ready' ? boot.config.maxMessageChars : 2000, `${view}:${activeId ?? ''}`, boot.phase === 'ready' && !!boot.config.speechLanguages?.length)
  const { loadHistory, clear } = chat
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const operationRef = useRef(false)
  const historyRequestRef = useRef(0)
  // Drafts stay in memory; guest history lives in this browser, account history on the server.
  const draftsRef = useRef<Record<string, string>>({})

  const refreshList = useCallback(async () => {
    const request = ++historyRequestRef.current
    setHistoryLoading(true)
    setHistoryFailed(false)
    try {
      const items = await getConversations()
      if (request === historyRequestRef.current) {
        setConversations(current => mergeConversations(current, items))
      }
    } catch {
      if (request === historyRequestRef.current) setHistoryFailed(true)
    } finally {
      if (request === historyRequestRef.current) setHistoryLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    // Config establishes the session before list loading and chat creation run in parallel.
    void getConfig().then(config => {
      if (!active) return
      setBoot({ phase: 'ready', config })
      void refreshList()
    }).catch(err => {
      if (active) setBoot({ phase: 'error', code: err instanceof ApiError ? err.code : 'INTERNAL' })
    })
    return () => { active = false; historyRequestRef.current += 1 }
  }, [loadAttempt, refreshList])

  const lastTurn = chat.turns.at(-1)
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [chat.turns.length, lastTurn?.phase, activeId])
  useEffect(() => {
    if (view === 'chat' && !switching) inputRef.current?.focus()
  }, [view, switching, activeId])
  useEffect(() => {
    if (!sidebarOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSidebarOpen(false)
        document.querySelector<HTMLButtonElement>('.history-toggle')?.focus()
      }
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [sidebarOpen])

  const ready = boot.phase === 'ready'
  const maxChars = boot.phase === 'ready' ? boot.config.maxMessageChars : 2000
  const locked = chat.busy || switching || !ready
  const startChat = async (example = '', sendImmediately = false) => {
    if (locked || operationRef.current) return
    if (activeId && chat.turns.length === 0 && !draft) {
      setDraft(example); setView('chat'); setSidebarOpen(false)
      if (sendImmediately && example) {
        setDraft('')
        draftsRef.current[activeId] = ''
        void chat.send(example).then(refreshList)
      }
      inputRef.current?.focus()
      return
    }
    operationRef.current = true
    setSwitching(true)
    setActionFailed(false)
    if (activeId) draftsRef.current[activeId] = draft
    clear()
    setActiveId(undefined)
    setDraft(example || (!activeId && view === 'chat' ? draft : ''))
    setView('chat')
    setSidebarOpen(false)
    try {
      const item = await createConversation()
      setConversations(items => mergeConversations(items, [item]))
      setActiveId(item.id)
      if (sendImmediately && example) {
        setDraft('')
        // Use the new ID immediately; this render still holds the previous chat ID.
        void chat.send(example, 'text', item.id).then(refreshList)
      }
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
  const submit = (attachments: ChatAttachment[] = []) => {
    const question = draft.trim() || (attachments.length ? t.files.defaultQuestion : '')
    if (!question || locked || !activeId) return
    setDraft('')
    draftsRef.current[activeId] = ''
    void chat.send(question, 'text', activeId, attachments).then(refreshList)
  }
  const pickExample = (text: string) => { setDraft(text); inputRef.current?.focus() }
  const cancelDelete = useCallback(() => setConfirmDelete(false), [])
  const removeData = async () => {
    setConfirmDelete(false)
    setSwitching(true)
    historyRequestRef.current += 1
    try {
      await deleteSession()
      const config = await getConfig()
      setBoot({ phase: 'ready', config })
      setConversations(await getConversations())
      setHistoryLoading(false); setHistoryFailed(false)
      clear(); setActiveId(undefined); setDraft(''); setView('home')
      draftsRef.current = {}
      setActionFailed(false)
    } catch { setActionFailed(true) }
    finally { setSwitching(false) }
  }
  const changeAccount = useCallback(async (credential: string | null) => {
    if (operationRef.current) throw new Error('Operation in progress')
    operationRef.current = true
    setSwitching(true)
    historyRequestRef.current += 1
    try {
      if (credential) await signInWithGoogle(credential)
      else await signOut()
      // Clear private UI before loading a different identity, even if config fails.
      clear(); setActiveId(undefined); setDraft(''); setView('home')
      setConversations([]); draftsRef.current = {}
      const config = await getConfig()
      setBoot({ phase: 'ready', config })
      await refreshList()
    } catch (err) {
      // Re-establish identity before another chat request after an ambiguous network error.
      setBoot({ phase: 'error', code: 'SESSION_CHANGED' })
      throw err
    } finally { setSwitching(false); operationRef.current = false }
  }, [clear, refreshList])
  const activeChat = conversations.find(item => item.id === activeId)
  const goHome = () => {
    setView('home'); setSidebarOpen(false)
    requestAnimationFrame(() => document.querySelector('.home-scroll')?.scrollTo({ top: 0 }))
  }
  const openGames = (entry?: GameEntry) => {
    setGames(current => ({ entry, key: current.key + 1 })); setView('games'); setSidebarOpen(false)
  }
  const openKnowledge = () => { setView('knowledge'); setSidebarOpen(false) }
  const goSection = (section: string) => {
    setView('home'); setSidebarOpen(false)
    requestAnimationFrame(() => {
      const target = document.getElementById(section)
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      target?.focus({ preventScroll: true })
    })
  }
  return <div className={`app workspace workspace--${view} ${appearance.mode === 'youth' ? 'workspace--youth' : ''} ${sidebarOpen ? 'workspace--history-open' : ''}`}>
    <a className="skip-link" href="#workspace-main">{view === 'home' ? t.home : t.inputLabel}</a>
    <div className="top"><Header theme={appearance.theme} onTheme={appearance.setTheme} onSettings={() => { setSidebarOpen(false); setSettingsOpen(true) }} onHome={goHome} disabled={locked} view={view}
      onStart={() => { if (activeId) { setView('chat'); setSidebarOpen(false) } else void startChat() }} onSection={goSection}
      onToggleHistory={() => setSidebarOpen(open => !open)} historyOpen={sidebarOpen} onGames={() => openGames()} onKnowledge={openKnowledge}
      onDeleteData={() => setConfirmDelete(true)} /></div>
    {sidebarOpen && <button className="sidebar-backdrop" aria-label={t.closeHistory} onClick={() => setSidebarOpen(false)} />}
    <aside className="chat-sidebar" id="chat-sidebar" aria-label={t.chatHistory} hidden={view !== 'chat' && !sidebarOpen}>
      <p className="sidebar-caption">{t.portal.sidebarCaption}</p>
      <button className="btn btn--primary sidebar-new" disabled={locked} onClick={() => void startChat()}><PlusIcon />{t.newChat}</button>
      <button className="sidebar-home" disabled={locked} onClick={goHome}><HomeIcon />{t.portal.returnToPortal}</button>
      <button className="sidebar-home" disabled={locked} onClick={() => goSection('resources')}><BookIcon />{t.portal.resources}</button>
      <div className="sidebar-heading"><h2>{t.chatHistory}</h2><span>{conversations.length}</span></div>
      <nav className="chat-list" aria-label={t.chatHistory} aria-busy={historyLoading}>
        {historyFailed && <div className="sidebar-empty" role="alert"><p>{t.historyLoadError}</p><button className="btn btn--ghost" onClick={() => void refreshList()}>{t.reload}</button></div>}
        {historyLoading && conversations.length === 0 && <div className="history-placeholder" aria-hidden="true"><span /><span /><span /></div>}
        {!historyLoading && !historyFailed && conversations.length === 0 && <p className="sidebar-empty">{t.noChats}</p>}
        {conversations.map(item => <button key={item.id} disabled={locked}
          aria-current={view === 'chat' && activeId === item.id ? 'page' : undefined}
          title={item.title || t.newChat} onClick={() => void openChat(item.id)}>
          <ChatIcon /><span>{item.title || t.newChat}</span>
          <time dateTime={new Date(item.updatedAt * 1000).toISOString()}>{new Date(item.updatedAt * 1000).toLocaleDateString(lang === 'kk' ? 'kk-KZ' : 'ru-RU', { day: '2-digit', month: '2-digit' })}</time>
        </button>)}
      </nav>
      <div className="sidebar-footer"><div className="sidebar-project"><span>A</span><div><strong>{t.portal.sidebarProject}</strong><small>{t.portal.sidebarProjectHint}</small></div></div><p>{boot.phase === 'ready' && boot.config.user ? accountCopy[lang].sidebar : t.historyHint}</p><a href="/admin">{t.management}<span aria-hidden="true">↗</span></a></div>
    </aside>
    <main className="workspace-main" id="workspace-main" tabIndex={-1} aria-busy={switching} inert={sidebarOpen}>
      {!online && <div className="banner banner--offline" role="status">{t.offline}</div>}
      {actionFailed && <div className="banner banner--error" role="alert">{t.actionFailed}<button className="btn btn--ghost" onClick={() => void refreshList()}>{t.reload}</button></div>}
      {boot.phase === 'error' && <div className="answer answer--error" role="alert"><h2>{t.configLoadError}</h2><p>{t.errors[boot.code]}</p><button className="btn btn--secondary" onClick={() => { setBoot({ phase: 'loading' }); setLoadAttempt(n => n + 1) }}>{t.reload}</button></div>}
      {view === 'home' && <div className="home-scroll"><Welcome youth={appearance.mode === 'youth'} character={appearance.character} onProfile={setProfile} onWork={() => appearance.setMode('work')} disabled={locked} maxChars={maxChars} onStart={() => void startChat()} onPickExample={text => void startChat(text)} onPickTopic={text => void startChat(text, true)} onGames={openGames} onKnowledge={openKnowledge} /></div>}
      {view === 'knowledge' && <KnowledgeBase onHome={goHome} />}
      {view === 'games' && <GamesHub key={games.key} entry={games.entry} initialCode={games.code} onHome={goHome} />}
      {view === 'chat' && <>
        <div className="chat-heading"><div><h1>{activeChat?.title || t.consultant}</h1><p>{t.portal.chatSubtitle}</p></div><button className="btn btn--secondary voice-launch" disabled={locked || !online} onClick={() => { voice.controller.end(); setVoiceOpen(true) }}><PhoneIcon />{t.voice.title}</button></div>
        {appearance.mode === 'youth' && <CharacterCompanion id={appearance.character} onProfile={setProfile} onSettings={() => setSettingsOpen(true)} />}
        <div className="chat-scroll" ref={scrollRef}>
          <div className="thread">
            {chat.turns.length === 0 ? <section className="empty-chat"><h2>{t.emptyChatTitle}</h2>{!switching && <Examples onPick={pickExample} disabled={locked} />}</section> :
              <ol className="turns" aria-live="polite">{chat.turns.map(turn => <TurnView key={turn.id} turn={turn} canRetry={turn.id === lastTurn?.id && !locked}
                canSpeak={voice.controller.canSpeak} speaking={voice.state.speakingId === turn.id}
                onSpeak={() => { if (turn.reply) voice.controller.read(turn.id, turn.reply.answer, turn.reply.responseLanguage) }}
                onRetry={id => { void chat.retry(id)?.then(refreshList) }} />)}</ol>}
          </div>
        </div>
        <footer className="composer-area"><Composer key={activeId} value={draft} onChange={setDraft} onSubmit={submit} busy={chat.busy || switching || !ready || !activeId} disabled={switching && !!activeId}
          maxChars={maxChars} inputRef={inputRef} />
          {!voiceOpen && voice.state.error && <p className="voice-error" role="alert">{t.voice.errors[voice.state.error]}</p>}
          <p className="composer-footnote">{t.portal.chatFootnote}</p>
        </footer>
      </>}
    </main>
    {settingsOpen && <AppearanceSettings config={boot.phase === 'ready' ? boot.config : undefined} disabled={locked} onAuth={changeAccount} theme={appearance.theme} onTheme={appearance.setTheme} mode={appearance.mode} character={appearance.character} onMode={appearance.setMode} onCharacter={appearance.setCharacter} onClose={() => setSettingsOpen(false)} />}
    {profile && appearance.mode === 'youth' && <CharacterProfile key={profile} id={profile} selected={appearance.character} onSelect={appearance.setCharacter} disabled={locked} onQuestion={text => { if (view === 'chat') pickExample(text); else void startChat(text) }} onClose={() => setProfile(null)} />}
    {confirmDelete && <ConfirmDialog title={t.deleteDataConfirmTitle} text={t.deleteDataConfirmText} confirmLabel={t.deleteDataConfirm} onConfirm={() => void removeData()} onCancel={cancelDelete} />}
    {voiceOpen && <VoiceCall controller={voice.controller} state={voice.state} busy={locked || !online}
      onClose={() => { voice.controller.end(); setVoiceOpen(false) }}
      onQuestion={async question => {
        const reply = await chat.send(question, 'voice')
        void refreshList()
        return reply
      }} />}
  </div>
}
