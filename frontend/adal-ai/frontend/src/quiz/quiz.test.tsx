import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CharacterQuiz } from '../components/CharacterQuiz'
import { CharacterProfile, CharacterRoster } from '../components/Characters'
import { characterIds, experienceCopy } from '../experience/content'
import { LangProvider } from '../i18n/LangProvider'
import { questionBank, quizCopy } from './content'
import { createRound, QUIZ_LENGTH, rankLevel, readBest, saveBest } from './game'
import type { CharacterId } from '../experience/content'
import type { Lang } from '../api/types'

Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, writable: true, value: function(this: HTMLDialogElement) { this.setAttribute('open', '') } })
Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, writable: true, value: function(this: HTMLDialogElement) { this.removeAttribute('open') } })
afterEach(() => vi.restoreAllMocks())

function finishRound(id: CharacterId, correctAnswers: number, lang: Lang = 'ru') {
  const c = quizCopy[lang]
  const seen = new Set<string>()
  for (let i = 0; i < QUIZ_LENGTH; i++) {
    expect(screen.getByText(`${c.question} ${i + 1} / ${QUIZ_LENGTH}`)).toBeInTheDocument()
    const item = questionBank[id].find(q => screen.queryByRole('heading', { name: q.text[lang] }))!
    expect(item).toBeDefined()
    expect(seen.has(item.id)).toBe(false)
    seen.add(item.id)
    const check = screen.getByRole('button', { name: c.check })
    expect(check).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: item.options[i < correctAnswers ? item.correct : 1][lang] }))
    fireEvent.click(check)
    for (const option of screen.getAllByRole('radio')) expect(option).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(i < correctAnswers ? c.correct : c.incorrect)
    expect(screen.getByRole('status')).toHaveTextContent(item.explanation[lang])
    expect(screen.queryByRole('button', { name: c.check })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: i === QUIZ_LENGTH - 1 ? c.finish : c.next }))
  }
  expect(screen.getByRole('heading', { name: c.result })).toHaveFocus()
}

describe('question bank and scoring', () => {
  it('contains 30 distinct bilingual questions with one unambiguous answer per question', () => {
    const all = Object.values(questionBank).flat()
    expect(all).toHaveLength(30)
    expect(new Set(all.map(q => q.id)).size).toBe(30)
    for (const id of characterIds) {
      expect(questionBank[id]).toHaveLength(QUIZ_LENGTH)
      const round = createRound(id)
      expect(new Set(round.map(q => q.id)).size).toBe(QUIZ_LENGTH)
      for (const item of round) {
        const original = questionBank[id].find(q => q.id === item.id)!
        expect(item.options[item.correct]).toEqual(original.options[original.correct])
        for (const lang of ['ru', 'kk'] as const) {
          expect(item.text[lang]).not.toBe('')
          expect(item.explanation[lang]).not.toBe('')
          expect(new Set(item.options.map(option => option[lang])).size).toBe(3)
          expect(item.options.every(option => option[lang].length > 0)).toBe(true)
        }
      }
    }
  })
  it.each([[0, 0], [4, 0], [5, 1], [7, 1], [8, 2], [10, 2]])('awards the correct tier for %i points', (score, rank) => {
    expect(rankLevel(score)).toBe(rank)
  })
  it('preserves the best score and stores specializations separately', () => {
    saveBest('alexey', 8)
    saveBest('asylbek', 5)
    expect(saveBest('alexey', 2)).toEqual({ best: 8, saved: true })
    expect(readBest('alexey')).toBe(8)
    expect(readBest('asylbek')).toBe(5)
    expect(readBest('asel')).toBeNull()
  })
  it.each(['{bad', 'null', '"10"', '-1', '11', '2.5', '{}'])('ignores corrupt stored score %s', value => {
    localStorage.setItem('adal.quiz.v1.asel', value)
    expect(readBest('asel')).toBeNull()
  })
})

describe('character quiz', () => {
  it.each(characterIds)('completes a perfect round for %s and shows its specialization on the roster', id => {
    const quiz = render(<CharacterQuiz id={id} titleId="quiz-title" onBack={() => {}} />)
    finishRound(id, 10)
    expect(screen.getByRole('heading', { name: quizCopy.ru.ranks[id][2] })).toBeInTheDocument()
    expect(readBest(id)).toBe(10)
    fireEvent.click(screen.getByText(quizCopy.ru.review))
    expect(screen.getAllByRole('listitem')).toHaveLength(10)
    quiz.unmount()
    render(<CharacterRoster selected={id} onProfile={() => {}} onWork={() => {}} />)
    const card = screen.getByRole('button', { name: `Личный профиль: ${experienceCopy.ru.characters[id].name}` })
    expect(within(card).getByText(`${quizCopy.ru.ranks[id][2]} · 10/10`)).toBeInTheDocument()
  })
  it('restarts with a clean score and keeps a better previous achievement', () => {
    saveBest('alexey', 10)
    render(<CharacterQuiz id="alexey" titleId="quiz-title" onBack={() => {}} />)
    finishRound('alexey', 5)
    expect(screen.getByRole('heading', { name: 'Знаток банкинга' })).toBeInTheDocument()
    expect(screen.getByText(/Лучший результат: 10/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Сыграть ещё раз' }))
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '0')
    finishRound('alexey', 0)
    expect(screen.getByRole('heading', { name: 'Новичок в банкинге' })).toBeInTheDocument()
    expect(readBest('alexey')).toBe(10)
  })
  it('runs in Kazakh without requiring chat access', () => {
    localStorage.setItem('adal.lang', 'kk')
    render(<LangProvider><CharacterProfile id="asel" selected="alexey" disabled onSelect={() => {}} onQuestion={() => {}} onClose={() => {}} /></LangProvider>)
    fireEvent.click(screen.getByRole('button', { name: /Викторинаны бастау/ }))
    finishRound('asel', 8, 'kk')
    expect(screen.getByRole('heading', { name: 'Заңдар мен кодекстер маманы' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Профильге оралу' }))
    expect(screen.getByText('Заңдар мен кодекстер маманы · 8/10')).toBeInTheDocument()
  })
  it('finishes even when browser storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    render(<CharacterQuiz id="asylbek" titleId="quiz-title" onBack={() => {}} />)
    finishRound('asylbek', 7)
    expect(screen.getByRole('heading', { name: 'Знаток права' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(quizCopy.ru.unsaved)
  })
})
