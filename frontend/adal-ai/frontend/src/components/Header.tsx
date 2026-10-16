import { useRef } from 'react'
import type { Lang } from '../api/types'
import { useI18n } from '../i18n/context'
import { DotsIcon, PlusIcon } from './Icons'

interface HeaderProps {
  canStartNew: boolean
  onNewChat: () => void
  onDeleteData: () => void
}

const LANGS: Lang[] = ['ru', 'kk']
const LANG_LABELS: Record<Lang, string> = { ru: 'RU', kk: 'KZ' }

export function Header({ canStartNew, onNewChat, onDeleteData }: HeaderProps) {
  const { t, lang, setLang } = useI18n()
  const menuRef = useRef<HTMLDetailsElement>(null)

  return (
    <>
    <div className="portal-strip"><div><span><i aria-hidden="true" />{t.portalLabel}</span><span>{t.portalCountry}</span></div></div>
    <header className="header">
      <div className="header__brand">
        <img src="/logo.svg" width="36" height="36" alt="" className="header__logo" />
        <div className="header__text">
          <h1 className="header__name">{t.appName}</h1>
          <p className="header__tagline">{t.serviceLabel}</p>
        </div>
      </div>
      <div className="header__actions">
        <div className="lang-switch" role="group" aria-label={t.langSwitchLabel}>
          {LANGS.map((code) => (
            <button
              key={code}
              type="button"
              className="lang-switch__option"
              aria-pressed={lang === code}
              lang={code}
              onClick={() => setLang(code)}
            >
              {LANG_LABELS[code]}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={onNewChat}
          disabled={!canStartNew}
          title={t.newChat}
        >
          <PlusIcon />
          <span className="btn__label">{t.newChat}</span>
        </button>
        <details className="menu" ref={menuRef}>
          <summary className="btn btn--ghost btn--icon" aria-label={t.menu} title={t.menu}>
            <DotsIcon />
          </summary>
          <div className="menu__popover">
            <button
              type="button"
              className="menu__item"
              onClick={() => {
                if (menuRef.current) menuRef.current.open = false
                onDeleteData()
              }}
            >
              {t.deleteData}
            </button>
          </div>
        </details>
      </div>
    </header>
    <nav className="portal-nav" aria-label={t.serviceLabel}><div>
      <a className="portal-nav__active" href="#composer-input">{t.consultant}</a>
      <span className="portal-nav__project">{t.projectLabel}</span>
      <a className="portal-nav__admin" href="/admin">{t.management}<span aria-hidden="true">↗</span></a>
    </div></nav>
    </>
  )
}
