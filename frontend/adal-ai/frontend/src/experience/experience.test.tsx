import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PhotoCarousel } from '../components/PhotoCarousel'
import { AppearanceSettings } from '../components/AppearanceSettings'
import { useAppearance } from './useAppearance'

Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, writable: true, value: function(this: HTMLDialogElement) { this.setAttribute('open', '') } })
Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, writable: true, value: function(this: HTMLDialogElement) { this.removeAttribute('open') } })

function Preferences() {
  const appearance = useAppearance()
  return <AppearanceSettings {...appearance} onTheme={appearance.setTheme} onMode={appearance.setMode} onCharacter={appearance.setCharacter} onClose={() => {}} />
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('cycles photographs every six seconds without playback controls', () => {
  vi.useFakeTimers()
  render(<PhotoCarousel />)
  expect(screen.getByRole('img', { name: 'Байтерек и панорама Астаны' })).toBeInTheDocument()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  act(() => vi.advanceTimersByTime(5999))
  expect(screen.getByRole('img', { name: 'Байтерек и панорама Астаны' })).toBeInTheDocument()
  act(() => vi.advanceTimersByTime(1))
  expect(screen.getByRole('img', { name: 'Панорама Алматы с холма Кок-Тобе' })).toBeInTheDocument()
  fireEvent.mouseEnter(screen.getByRole('region', { name: 'Открывайте Казахстан' }))
  act(() => vi.advanceTimersByTime(6000))
  expect(screen.getByRole('img', { name: /Ворота исторического/ })).toBeInTheDocument()
  act(() => vi.advanceTimersByTime(6000))
  expect(screen.getByRole('img', { name: 'Байтерек и панорама Астаны' })).toBeInTheDocument()
})
it('persists youth mode and character, and can return to work mode', () => {
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function(this: HTMLDialogElement) { this.setAttribute('open', '') })
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function(this: HTMLDialogElement) { this.removeAttribute('open') })
  const first = render(<Preferences />)
  fireEvent.click(screen.getByRole('radio', { name: /Молодёжный/ }))
  fireEvent.click(screen.getByRole('radio', { name: 'Асель' }))
  first.unmount()
  render(<Preferences />)
  expect(screen.getByRole('radio', { name: /Молодёжный/ })).toBeChecked()
  expect(screen.getByRole('radio', { name: 'Асель' })).toBeChecked()
  fireEvent.click(screen.getByRole('radio', { name: /Рабочий/ }))
  expect(screen.queryByRole('radio', { name: 'Асель' })).not.toBeInTheDocument()
  expect(JSON.parse(localStorage.getItem('adal.appearance')!)).toEqual({ mode: 'work', character: 'asel', theme: 'light' })
})
it('recovers from invalid saved preferences', () => {
  localStorage.setItem('adal.appearance', '{broken')
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function(this: HTMLDialogElement) { this.setAttribute('open', '') })
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(() => {})
  render(<Preferences />)
  expect(screen.getByRole('radio', { name: /Рабочий/ })).toBeChecked()
})

it('applies and persists the theme independently of mode and character', () => {
  localStorage.setItem('adal.appearance', JSON.stringify({ mode: 'youth', character: 'asel' }))
  const first = render(<Preferences />)
  expect(screen.getByRole('radio', { name: 'Светлая' })).toBeChecked()
  fireEvent.click(screen.getByRole('radio', { name: 'Тёмная' }))
  expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
  first.unmount()
  render(<Preferences />)
  expect(screen.getByRole('radio', { name: 'Тёмная' })).toBeChecked()
  expect(screen.getByRole('radio', { name: 'Асель' })).toBeChecked()
  fireEvent.click(screen.getByRole('radio', { name: /Рабочий/ }))
  expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
  fireEvent.click(screen.getByRole('radio', { name: 'Светлая' }))
  expect(document.documentElement).toHaveAttribute('data-theme', 'light')
  expect(JSON.parse(localStorage.getItem('adal.appearance')!)).toEqual({ mode: 'work', character: 'asel', theme: 'light' })
})
it('keeps theme switching usable when storage is unavailable', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
  render(<Preferences />)
  fireEvent.click(screen.getByRole('radio', { name: 'Тёмная' }))
  expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
})
