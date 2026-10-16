interface GoogleIdentity {
  initialize: (options: { client_id: string; nonce: string; callback: (response: { credential: string }) => void; auto_select: boolean }) => void
  renderButton: (element: HTMLElement, options: { type: string; theme: string; size: string; text: string; locale: string }) => void
  disableAutoSelect: () => void
}
declare global { interface Window { google?: { accounts: { id: GoogleIdentity } } } }
let pending: Promise<GoogleIdentity> | undefined

export function loadGoogle(): Promise<GoogleIdentity> {
  if (window.google?.accounts.id) return Promise.resolve(window.google.accounts.id)
  if (pending) return pending
  pending = new Promise<GoogleIdentity>((resolve, reject) => {
    const script = document.createElement('script')
    const fail = () => { clearTimeout(timer); script.remove(); pending = undefined; reject(new Error('Google unavailable')) }
    const timer = setTimeout(fail, 15000)
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onerror = fail
    script.onload = () => {
      clearTimeout(timer)
      if (window.google?.accounts.id) resolve(window.google.accounts.id)
      else fail()
    }
    document.head.append(script)
  })
  return pending
}
