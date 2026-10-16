import { useI18n } from '../i18n/context'
import { SendIcon } from './Icons'

export function Examples({ onPick, disabled = false }: { onPick: (text: string) => void; disabled?: boolean }) {
  const { t } = useI18n()
  return <div className="quick-questions">
    <h3>{t.examplesTitle}</h3>
    <ul>{t.examples.map((example, index) => <li key={example}>
      <button disabled={disabled} onClick={() => onPick(example)}>
        <span><strong>{t.topicTitles[index]}</strong><span>{example}</span></span><SendIcon />
      </button>
    </li>)}</ul>
  </div>
}

export function Welcome({ onStart, onPickExample, disabled }: { onStart: () => void; onPickExample: (text: string) => void; disabled: boolean }) {
  const { t } = useI18n()
  return <section className="welcome" aria-labelledby="welcome-title">
    <div className="welcome__intro">
      <h1 id="welcome-title">{t.landingTitle}</h1>
      <p>{t.landingText}</p>
      <button className="btn btn--primary welcome__start" disabled={disabled} onClick={onStart}>{t.startChat}<SendIcon /></button>
    </div>
    <Examples onPick={onPickExample} disabled={disabled} />
    <div className="welcome__notes"><p>{t.disclaimerStudent}</p><p>{t.disclaimerAi}</p></div>
  </section>
}
