import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { safeHttpUrl } from '../api/client'

/**
 * Безопасный вывод ответа ИИ (недоверенные данные):
 * - сырой HTML не отображается (skipHtml), скрипты и теги не исполняются;
 * - разрешён только список простых элементов; изображения запрещены,
 *   чтобы страница не загружала произвольные адреса;
 * - ссылки — только абсолютные http(s), открываются в новой вкладке без доступа к opener.
 */
const ALLOWED_ELEMENTS = [
  'p', 'br', 'strong', 'em', 'del', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'a', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
]

const components: Components = {
  a: ({ href, children }) =>
    href ? (
      <a href={href} target="_blank" rel="noopener noreferrer nofollow">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  table: ({ children }) => (
    <div className="table-scroll">
      <table>{children}</table>
    </div>
  ),
}

const urlTransform = (url: string) => safeHttpUrl(url) ?? ''

export function SafeMarkdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        allowedElements={ALLOWED_ELEMENTS}
        unwrapDisallowed
        urlTransform={urlTransform}
        components={components}
      >
        {text}
      </Markdown>
    </div>
  )
}
