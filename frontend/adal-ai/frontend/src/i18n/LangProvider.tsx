import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Lang } from '../api/types'
import { I18nContext } from './context'
import { kk } from './kk'
import { ru } from './ru'

const STORAGE_KEY = 'adal.lang'
const DICTS = { ru, kk }

/** Выбор языка: сохранённый ранее, затем язык браузера (kk* → KZ), иначе русский. */
function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'ru' || saved === 'kk') return saved
  } catch {
    // localStorage может быть недоступен (приватный режим) — это не ошибка
  }
  const browserLangs = typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language]
  return browserLangs.some((code) => code?.toLowerCase().startsWith('kk')) ? 'kk' : 'ru'
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang)

  useEffect(() => {
    document.documentElement.lang = lang
    document.title = DICTS[lang].documentTitle
  }, [lang])

  const value = useMemo(
    () => ({
      lang,
      t: DICTS[lang],
      setLang: (next: Lang) => {
        setLangState(next)
        try {
          localStorage.setItem(STORAGE_KEY, next)
        } catch {
          // выбор просто не запомнится между визитами
        }
      },
    }),
    [lang],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
