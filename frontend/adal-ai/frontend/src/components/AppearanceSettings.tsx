import { AccountSettings } from './AccountSettings'
import type { PublicConfig } from '../api/types'
import { useId } from 'react'
import { useI18n } from '../i18n/context'
import { characterIds, experienceCopy, type CharacterId, type DisplayMode } from '../experience/content'
import { ExperienceDialog } from './ExperienceDialog'
import type { ColorTheme } from '../experience/useAppearance'
import { BookIcon, SunIcon, MoonIcon } from './Icons'
export function AppearanceSettings({ config, disabled = false, onAuth, mode, character, theme, onTheme, onMode, onCharacter, onClose }: { config?: PublicConfig; disabled?: boolean; onAuth?: (credential: string | null) => Promise<void>; theme: ColorTheme; onTheme: (theme: ColorTheme) => void; mode: DisplayMode; character: CharacterId; onMode: (mode: DisplayMode) => void; onCharacter: (id: CharacterId) => void; onClose: () => void }) {
  const { lang } = useI18n()
  const c = experienceCopy[lang]
  const titleId = useId()
  return <ExperienceDialog titleId={titleId} onClose={onClose} className="appearance-settings">
    <p className="eyebrow">{c.settings}</p><h2 id={titleId}>{c.appearance}</h2><p className="dialog-intro">{c.settingsIntro}</p>
    {onAuth && <AccountSettings config={config} disabled={disabled} onAuth={onAuth} />}
    <fieldset className="theme-options"><legend>{c.theme}</legend>
      {(['light', 'dark'] as const).map(id => <label key={id} className={`theme-option ${theme === id ? 'is-selected' : ''}`}>
        <input type="radio" name="color-theme" value={id} checked={theme === id} onChange={() => onTheme(id)} />
        {id === 'light' ? <SunIcon /> : <MoonIcon />}<span>{c[id]}</span>
      </label>)}
    </fieldset>
    <fieldset className="mode-options"><legend>{c.mode}</legend>
      {(['work', 'youth'] as const).map(modeId => <label key={modeId} className={`mode-option ${mode === modeId ? 'is-selected' : ''}`}>
        <input type="radio" name="display-mode" value={modeId} checked={mode === modeId} onChange={() => onMode(modeId)} />
        <span className={`mode-preview mode-preview--${modeId}`} aria-hidden="true">{modeId === 'work' ? <><BookIcon /><i /><i /><i /></> : characterIds.map(id => <img src={`/characters/${id}.jpg`} alt="" key={id} />)}</span>
        <strong>{c[modeId]}</strong><span>{modeId === 'work' ? c.workHint : c.youthHint}</span>
      </label>)}
    </fieldset>
    {mode === 'youth' && <fieldset className="character-options"><legend>{c.choose}</legend>{characterIds.map(id => <label key={id}><input type="radio" name="character" checked={character === id} onChange={() => onCharacter(id)} /><img src={`/characters/${id}.jpg`} alt="" /><span>{c.characters[id].name}</span></label>)}</fieldset>}
    <div className="settings-footer"><p>{c.saved}</p><button className="btn btn--primary" onClick={onClose}>{c.done}</button></div>
  </ExperienceDialog>
}
