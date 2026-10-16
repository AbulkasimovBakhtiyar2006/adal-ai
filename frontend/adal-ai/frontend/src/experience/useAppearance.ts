import { useEffect, useState } from 'react'
import { characterIds, type CharacterId, type DisplayMode } from './content'

const KEY = 'adal.appearance'
export type ColorTheme = 'light' | 'dark'
interface Appearance { mode: DisplayMode; character: CharacterId; theme: ColorTheme }
function read(): Appearance {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}')
    return {
      mode: saved?.mode === 'youth' ? 'youth' : 'work',
      character: characterIds.includes(saved?.character) ? saved.character : 'alexey',
      theme: saved?.theme === 'dark' ? 'dark' : 'light',
    }
  } catch { return { mode: 'work', character: 'alexey', theme: 'light' } }
}
export function useAppearance() {
  const [appearance, setAppearance] = useState(read)
  useEffect(() => {
    document.documentElement.dataset.theme = appearance.theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', appearance.theme === 'dark' ? '#101722' : '#2855a6')
  }, [appearance.theme])
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(appearance)) } catch { /* The current session remains usable without storage. */ }
  }, [appearance])
  return {
    ...appearance,
    setMode: (mode: DisplayMode) => setAppearance(current => ({ ...current, mode })),
    setCharacter: (character: CharacterId) => setAppearance(current => ({ ...current, character })),
    setTheme: (theme: ColorTheme) => setAppearance(current => ({ ...current, theme })),
  }
}
