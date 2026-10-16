import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SafeMarkdown } from './SafeMarkdown'

describe('SafeMarkdown', () => {
  it('отображает простую разметку', () => {
    const { container } = render(<SafeMarkdown text={'**жирный**\n\n- пункт'} />)
    expect(container.querySelector('strong')).toHaveTextContent('жирный')
    expect(container.querySelector('li')).toHaveTextContent('пункт')
  })

  it('не вставляет HTML и скрипты из ответа', () => {
    const { container } = render(
      <SafeMarkdown text={'<script>window.__xss = 1</script>\n\nТекст <b>без тега</b> <img src="x" onerror="alert(1)">'} />,
    )
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.innerHTML).not.toContain('onerror')
  })

  it('не загружает изображения из Markdown', () => {
    const { container } = render(<SafeMarkdown text="![пиксель](https://example.org/p.png)" />)
    expect(container.querySelector('img')).toBeNull()
  })

  it('убирает опасные ссылки и защищает внешние', () => {
    render(<SafeMarkdown text="[плохая](javascript:alert(1)) [хорошая](https://example.org/doc)" />)
    expect(screen.queryByRole('link', { name: 'плохая' })).toBeNull()
    expect(screen.getByText('плохая')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'хорошая' })
    expect(link).toHaveAttribute('href', 'https://example.org/doc')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow')
  })
})
