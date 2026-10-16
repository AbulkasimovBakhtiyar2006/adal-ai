import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Sources } from './Sources'

describe('Sources', () => {
  it('ничего не показывает, если источников нет', () => {
    const { container } = render(<Sources sources={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('показывает документ без URL без ссылки, но с реквизитами', () => {
    render(<Sources sources={[{ title: 'Документ без адреса', url: null, details: 'Раздел 2' }]} />)
    expect(screen.getByText('Документ без адреса')).toBeInTheDocument()
    expect(screen.getByText('Раздел 2')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('показывает ссылку с доменом для источника с URL', () => {
    render(<Sources sources={[{ title: 'Документ', url: 'https://example.org/a/b', details: null }]} />)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', 'https://example.org/a/b')
    expect(link).toHaveTextContent('example.org')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow')
  })

  it('не строит ссылку из небезопасного адреса', () => {
    render(<Sources sources={[{ title: 'Подозрительный', url: 'javascript:alert(1)', details: null }]} />)
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('не ставит отметку «проверено» из-за наличия ссылки', () => {
    const { container } = render(
      <Sources sources={[{ title: 'Документ', url: 'https://example.org/', details: null }]} />,
    )
    expect(container.textContent?.toLowerCase()).not.toMatch(/провер|тексерілді|verified/)
  })
})
