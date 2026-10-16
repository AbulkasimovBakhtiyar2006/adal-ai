import { createContext, useContext } from 'react'
import type { Lang } from '../api/types'
import { ru, type Dict } from './ru'

export interface I18n {
  lang: Lang
  t: Dict
  setLang: (lang: Lang) => void
}

export const I18nContext = createContext<I18n>({ lang: 'ru', t: ru, setLang: () => {} })

export function useI18n(): I18n {
  return useContext(I18nContext)
}
