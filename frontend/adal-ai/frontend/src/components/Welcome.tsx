import { useI18n } from '../i18n/context'
import type { ReactNode } from 'react'
import { SendIcon } from './Icons'

/** Главный экран: что умеет Adal AI, примеры вопросов и пометки о проекте. */
export function Welcome({ onPickExample, children }: { onPickExample: (text: string) => void; children: ReactNode }) {
  const { t } = useI18n()
  return (
    <section className="welcome" aria-labelledby="welcome-title">
      <div className="welcome__hero"><div className="welcome__intro">
      <p className="portal-eyebrow">{t.heroEyebrow}</p>
      <h2 id="welcome-title" className="welcome__title">
        {t.welcomeTitle}
      </h2>
      <p className="welcome__text">{t.welcomeText}</p>
      <span className="welcome__language">РУС / ҚАЗ <span aria-hidden="true">·</span> {t.serviceLabel}</span>
      </div>
      <aside className="reference-card">
        <svg className="reference-card__icon" width="44" height="44" viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M9 10h13l2 3 2-3h13v28H26l-2 3-2-3H9V10Z" stroke="currentColor" strokeWidth="1.7"/><path d="M24 14v22M14 19h5m-5 6h5m10-6h5m-5 6h5" stroke="currentColor" strokeWidth="1.7"/></svg>
        <h3>{t.referenceTitle}</h3><p>{t.referenceSubtitle}</p>
        <ul>{t.documentTypes.map((type) => <li key={type}><span aria-hidden="true">—</span>{type}</li>)}</ul>
      </aside></div>

      <div className="question-panel"><div className="question-panel__heading"><span className="section-marker" aria-hidden="true">01</span><h3>{t.composeTitle}</h3></div>{children}</div>

      <div className="section-heading"><div>
      <h3 className="welcome__subtitle">{t.examplesTitle}</h3>
      <p className="welcome__hint" id="examples-hint">
        {t.examplesHint}
      </p>
      </div><span className="section-heading__line" aria-hidden="true" /></div>
      <ul className="examples">
        {t.examples.map((example, index) => (
          <li key={example}>
            <button
              type="button"
              className="example"
              aria-describedby="examples-hint"
              onClick={() => onPickExample(example)}
              aria-label={example}
            >
              <span className="example__topic">{t.topicTitles[index]}</span>
              <span className="example__text">{example}</span>
              <span className="example__bottom"><span aria-hidden="true">0{index + 1}</span><SendIcon /></span>
            </button>
          </li>
        ))}
      </ul>

      <section className="how-it-works"><h3>{t.howTitle}</h3><ol className="welcome__points">
        {t.welcomePoints.map((point, index) => <li key={point}><span className="how-it-works__number" aria-hidden="true">0{index + 1}</span><div><h4>{t.stepTitles[index]}</h4><p>{point}</p></div></li>)}
      </ol></section>

      <div className="welcome__notes">
        <p>{t.disclaimerStudent}</p>
        <p>{t.disclaimerAi}</p>
      </div>
      <div className="portal-footer"><span>© Adal AI</span><span>{t.projectLabel}</span></div>
    </section>
  )
}
