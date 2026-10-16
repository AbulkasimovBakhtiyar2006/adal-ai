import { useState } from 'react'
import { useI18n } from '../i18n/context'
import { BookIcon, BuildingIcon, ExternalIcon, LeafIcon, MicIcon, SearchIcon, SendIcon } from './Icons'

const topicIcons = [BuildingIcon, BookIcon, LeafIcon]

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

export function Welcome({ onStart, onPickExample, disabled, maxChars }: { onStart: () => void; onPickExample: (text: string) => void; disabled: boolean; maxChars: number }) {
  const { t, lang } = useI18n()
  const [question, setQuestion] = useState('')
  const [category, setCategory] = useState<'topics' | 'documents'>('topics')
  const resources = [
    { name: 'GOV.KZ', url: `https://www.gov.kz/?lang=${lang === 'kk' ? 'kz' : 'ru'}`, text: t.portal.gov },
    { name: 'Әділет', url: `https://adilet.zan.kz/${lang === 'kk' ? 'kaz' : 'rus'}`, text: t.portal.adilet },
    { name: 'AKORDA', url: `https://www.akorda.kz/${lang === 'kk' ? 'kz' : 'ru'}`, text: t.portal.akorda },
  ]
  return <div className="welcome">
    <section className="portal-hero" aria-labelledby="welcome-title">
      <div className="portal-hero__copy">
        <p className="eyebrow"><span />{t.heroEyebrow}</p>
        <h1 id="welcome-title">{t.landingTitle}</h1>
        <p className="portal-hero__description">{t.portal.heroText}</p>
        <button className="btn btn--primary welcome__start" disabled={disabled} onClick={onStart}>{t.startChat}<SendIcon /></button>
      </div>
      <figure className="portal-hero__image">
        <img src="/astana.jpg" width="1280" height="852" alt={t.portal.astanaAlt} fetchPriority="high" />
        <figcaption><span>{t.portal.astana}</span><span>{t.portalCountry}</span></figcaption>
      </figure>
    </section>
    <section className="portal-ask" aria-labelledby="portal-ask-title">
      <div><h2 id="portal-ask-title">{t.composeTitle}</h2><p>{t.portal.askHint}</p></div>
      <form onSubmit={event => { event.preventDefault(); if (question.trim() && !disabled) onPickExample(question.trim()) }}>
        <SearchIcon /><input aria-label={t.portal.questionLabel} value={question} onChange={event => setQuestion(event.target.value)} maxLength={maxChars} placeholder={t.portal.questionPlaceholder} disabled={disabled} />
        <button className="btn btn--primary" disabled={disabled || !question.trim()} type="submit">{t.portal.ask}<SendIcon /></button>
      </form>
      <div className="portal-ask__meta"><span>{t.portal.bilingual}</span><span><MicIcon />{t.portal.voiceAvailable}</span></div>
    </section>
    <section id="topics" className="portal-section" aria-labelledby="topics-title" tabIndex={-1}>
      <div className="section-heading"><div><p className="eyebrow">{t.portal.explore}</p><h2 id="topics-title">{t.portal.topicsTitle}</h2></div>
        <div className="portal-tabs" role="group" aria-label={t.portal.categories}>
          <button aria-pressed={category === 'topics'} onClick={() => setCategory('topics')}>{t.portal.topics}</button>
          <button aria-pressed={category === 'documents'} onClick={() => setCategory('documents')}>{t.portal.documents}</button>
        </div>
      </div>
      <div className="topic-grid">{(category === 'topics' ? t.topicTitles : t.documentTypes).map((title, index) => {
        const TopicIcon = topicIcons[index]
        return <button className="topic-card" key={title} disabled={disabled} aria-label={`${title}: ${category === 'topics' ? t.examples[index] : t.portal.documentQuestions[index]}`} onClick={() => onPickExample(category === 'topics' ? t.examples[index] : t.portal.documentQuestions[index])}>
          <span className="topic-card__top"><TopicIcon /><span>0{index + 1}</span></span>
          <h3>{title}</h3><p>{category === 'topics' ? t.portal.topicDescriptions[index] : t.portal.documentDescriptions[index]}</p>
          <span className="topic-card__action">{t.portal.exploreTopic}<SendIcon /></span>
        </button>
      })}</div>
    </section>
    <section id="resources" className="portal-section resources-section" aria-labelledby="resources-title" tabIndex={-1}>
      <div className="section-heading"><div><p className="eyebrow">{t.portal.primarySources}</p><h2 id="resources-title">{t.portal.resources}</h2></div><p className="section-heading__note">{t.portal.resourceHint}</p></div>
      <div className="resource-grid">{resources.map(resource => <a href={resource.url} key={resource.name} target="_blank" rel="noopener noreferrer" className="resource-link">
        <div><strong>{resource.name}</strong><p>{resource.text}</p><span>{new URL(resource.url).hostname}</span></div><ExternalIcon />
      </a>)}</div>
    </section>
    <section id="about" className="portal-section how-section" aria-labelledby="how-title" tabIndex={-1}>
      <div className="section-heading"><div><p className="eyebrow">{t.portal.simpleStart}</p><h2 id="how-title">{t.howTitle}</h2></div></div>
      <ol className="how-steps">{t.stepTitles.map((title, index) => <li key={title}><span>0{index + 1}</span><div><h3>{title}</h3><p>{t.portal.steps[index]}</p></div></li>)}</ol>
    </section>
    <footer className="portal-footer"><div><strong>Adal AI</strong><p>{t.portalLabel}</p></div><div className="portal-footer__notes"><p>{t.disclaimerStudent}</p><p>{t.disclaimerAi}</p></div><a href="https://www.akorda.kz/ru/republic_of_kazakhstan/astana" target="_blank" rel="noopener noreferrer">{t.portal.photoCredit}<ExternalIcon /></a></footer>
  </div>
}
