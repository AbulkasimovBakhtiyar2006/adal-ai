import { safeHttpUrl } from '../api/client'
import type { Source } from '../api/types'
import { useI18n } from '../i18n/context'
import { ExternalIcon } from './Icons'

/**
 * Источники показываются ровно так, как их передал ИИ-модуль.
 * Без url ссылка не строится. Отметок «проверено» нет: наличие ссылки
 * не доказывает правильность ответа.
 */
export function Sources({ sources }: { sources: Source[] }) {
  const { t } = useI18n()
  if (sources.length === 0) return null

  return (
    <section className="sources" aria-label={t.sourcesTitle}>
      <h3 className="sources__title">{t.sourcesTitle}</h3>
      <ol className="sources__list">
        {sources.map((source, index) => {
          const url = safeHttpUrl(source.url)
          const host = url ? new URL(url).hostname : null
          return (
            <li key={`${index}-${source.title}`} className="source">
              <span className="source__title">{source.title}</span>
              {source.details && <span className="source__details">{source.details}</span>}
              {url && host && (
                <a
                  className="source__link"
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  aria-label={t.sourceLinkLabel(source.title, host)}
                >
                  {host}
                  <ExternalIcon />
                </a>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
