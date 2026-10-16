import { describe, expect, it } from 'vitest'
import { ERROR_CODES } from '../api/types'
import { kk } from './kk'
import { ru } from './ru'

function flatten(value: unknown, prefix = ''): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value).reduce<Record<string, unknown>>(
      (acc, [key, inner]) => ({ ...acc, ...flatten(inner, prefix ? `${prefix}.${key}` : key) }),
      {},
    )
  }
  return { [prefix]: value }
}

describe('словари RU и KZ', () => {
  const ruFlat = flatten(ru)
  const kkFlat = flatten(kk)

  it('содержат одинаковый набор ключей', () => {
    expect(Object.keys(kkFlat).sort()).toEqual(Object.keys(ruFlat).sort())
  })

  it('не содержат пустых строк', () => {
    for (const [key, value] of Object.entries({ ...ruFlat, ...kkFlat })) {
      if (typeof value === 'string') expect(value.trim(), key).not.toBe('')
      if (Array.isArray(value)) value.forEach((item) => expect(String(item).trim(), key).not.toBe(''))
    }
  })

  it('переводят каждый код ошибки', () => {
    for (const code of ERROR_CODES) {
      expect(ru.errors[code]).toBeTruthy()
      expect(kk.errors[code]).toBeTruthy()
    }
  })

  it('казахский текст действительно отличается от русского', () => {
    expect(kk.welcomeTitle).not.toBe(ru.welcomeTitle)
    expect(kk.examples).toHaveLength(ru.examples.length)
    expect(kk.examples).not.toEqual(ru.examples)
  })
})
