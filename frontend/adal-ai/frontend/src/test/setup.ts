import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// В jsdom нет прокрутки окна.
window.scrollTo = () => {}

afterEach(() => {
  cleanup()
  localStorage.clear()
})
