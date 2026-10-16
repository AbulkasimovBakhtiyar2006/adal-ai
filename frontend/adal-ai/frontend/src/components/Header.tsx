import { useRef } from 'react'
import type { Lang } from '../api/types'
import { useI18n } from '../i18n/context'
import { DotsIcon, MenuIcon } from './Icons'

interface HeaderProps {
  onHome: () => void
  onStart: () => void
  onSection: (section: string) => void
  onToggleHistory: () => void
  historyOpen: boolean
  onDeleteData: () => void
  disabled: boolean
  view: 'home' | 'chat'
}
const LANGS: Lang[] = ['ru', 'kk']

export function Header({ onHome, onStart, onSection, onToggleHistory, historyOpen, onDeleteData, disabled, view }: HeaderProps) {
  const { t, lang, setLang } = useI18n()
  const menuRef = useRef<HTMLDetailsElement>(null)
  return <>
    <div className="utility-bar"><span>{t.portalCountry}</span><span>{t.projectLabel}</span></div>
    <header className="header">
      <button className="header__brand" onClick={onHome} disabled={disabled} aria-label={`${t.appName} — ${t.home}`}>
        <img src="/kazakhstan-emblem.jpg" width="48" height="50" alt={t.portal.emblem} className="header__logo" />
        <span className="header__text"><span className="header__name">Adal <b>AI</b></span><span className="header__tagline">{t.portalLabel}</span></span>
      </button>
      <nav className="header__nav" aria-label={t.portal.navigation}>
        <button disabled={disabled} aria-current={view === 'home' ? 'page' : undefined} onClick={onHome}>{t.home}</button>
        <button disabled={disabled} aria-current={view === 'chat' ? 'page' : undefined} onClick={onStart}>{t.consultant}</button>
        <button disabled={disabled} onClick={() => onSection('topics')}>{t.portal.topics}</button>
        <button disabled={disabled} onClick={() => onSection('resources')}>{t.portal.resources}</button>
      </nav>
      <div className="header__actions">
        <button className="btn btn--ghost history-toggle" aria-label={t.chatHistory} aria-expanded={historyOpen} aria-controls="chat-sidebar" onClick={onToggleHistory}><MenuIcon /></button>
        <div className="lang-switch" role="group" aria-label={t.langSwitchLabel}>
          {LANGS.map(code => <button key={code} className="lang-switch__option" aria-pressed={lang === code} lang={code} onClick={() => setLang(code)}>{code === 'kk' ? 'KZ' : 'RU'}</button>)}
        </div>
        <details className="menu" ref={menuRef}>
          <summary className="btn btn--ghost btn--icon" aria-label={t.menu}><DotsIcon /></summary>
          <div className="menu__popover">
            <a className="menu__item" href="/admin">{t.management}</a>
            <button className="menu__item" disabled={disabled} onClick={() => {
              if (menuRef.current) menuRef.current.open = false
              onDeleteData()
            }}>{t.deleteData}</button>
          </div>
        </details>
      </div>
    </header>
  </>
}
