import { useRef } from 'react'
import type { Lang } from '../api/types'
import { useI18n } from '../i18n/context'
import { DotsIcon } from './Icons'

interface HeaderProps {
  onHome: () => void
  onToggleHistory: () => void
  historyOpen: boolean
  onDeleteData: () => void
  disabled: boolean
}
const LANGS: Lang[] = ['ru', 'kk']

export function Header({ onHome, onToggleHistory, historyOpen, onDeleteData, disabled }: HeaderProps) {
  const { t, lang, setLang } = useI18n()
  const menuRef = useRef<HTMLDetailsElement>(null)
  return (
    <header className="header">
      <button className="header__brand" onClick={onHome} disabled={disabled} aria-label={`${t.appName} — ${t.home}`}>
        <img src="/logo.svg" width="40" height="40" alt="" className="header__logo" />
        <span className="header__name">{t.appName}</span>
      </button>
      <span className="header__tagline">{t.serviceLabel}</span>
      <div className="header__actions">
        <button className="btn btn--ghost history-toggle" aria-label={t.chatHistory} aria-expanded={historyOpen} aria-controls="chat-sidebar" onClick={onToggleHistory}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 5h16v12H9l-5 4V5Z"/><path d="M8 9h8M8 13h5"/></svg>
        </button>
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
  )
}
