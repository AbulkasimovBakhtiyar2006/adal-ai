import { useEffect, useRef, useState } from 'react'
import type { PublicConfig } from '../api/types'
import { accountCopy } from '../account/copy'
import { loadGoogle } from '../account/google'
import { useI18n } from '../i18n/context'

export function AccountSettings({ config, disabled, onAuth }: { config?: PublicConfig; disabled: boolean; onAuth: (credential: string | null) => Promise<void> }) {
  const { lang } = useI18n()
  const c = accountCopy[lang]
  const buttonRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'busy' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const user = config?.user
  useEffect(() => {
    if (!config?.googleClientId || !config.googleNonce || user || disabled) return
    let active = true
    const target = buttonRef.current
    void loadGoogle().then(google => {
      if (!active || !target) return
      google.initialize({ client_id: config.googleClientId!, nonce: config.googleNonce!, auto_select: false,
        callback: response => {
          if (!active) return
          setStatus('busy')
          void onAuth(response.credential).then(() => setStatus('ready')).catch(() => setStatus('error'))
        },
      })
      target.replaceChildren()
      google.renderButton(target, { type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', locale: lang === 'kk' ? 'kk' : 'ru' })
      setStatus('ready')
    }).catch(() => { if (active) setStatus('error') })
    return () => { active = false; target?.replaceChildren() }
  }, [config?.googleClientId, config?.googleNonce, user, disabled, lang, attempt, onAuth])

  const logout = async () => {
    setStatus('busy')
    try {
      await onAuth(null)
      window.google?.accounts.id.disableAutoSelect()
      setStatus('ready')
    } catch { setStatus('error') }
  }
  return <section className="account-settings" aria-labelledby="account-settings-title" aria-busy={status === 'busy'}>
    <h3 id="account-settings-title">{c.title}</h3>
    <div className="account-identity"><span className="account-avatar" aria-hidden="true">{user ? user.name.slice(0, 1).toUpperCase() : 'G'}</span><div><strong>{user?.name || c.guest}</strong>{user && <small>{user.email}</small>}</div></div>
    <p>{user ? c.accountHint : c.guestHint}</p>
    {user ? <button className="btn btn--secondary" disabled={disabled || status === 'busy'} onClick={() => void logout()}>{c.signOut}</button> : <>
      <p>{c.signInHint}</p>
      {config?.googleClientId && config.googleNonce ? <>
        <div ref={buttonRef} className="google-signin" aria-label={c.signIn} inert={disabled || status === 'busy'} />
        {status === 'loading' && <p role="status">{c.loading}</p>}
      </> : <><button className="btn btn--secondary" disabled>{c.signIn}</button><p className="account-note">{c.unavailable}</p></>}
    </>}
    {status === 'busy' && <p role="status">{c.busy}</p>}
    {status === 'error' && <div role="alert"><p>{c.failed}</p>{!user && <button className="btn btn--ghost" disabled={disabled} onClick={() => { setStatus('loading'); setAttempt(value => value + 1) }}>{c.retry}</button>}</div>}
  </section>
}
