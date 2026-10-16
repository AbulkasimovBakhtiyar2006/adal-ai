import { PhotoCarousel } from './PhotoCarousel'
import { Wordmark } from './Wordmark'
import { CharacterRoster } from './Characters'
import type { CharacterId } from '../experience/content'
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

export function Welcome({ onStart, onPickExample, onPickTopic, disabled, maxChars, youth = false, character = 'alexey', onProfile, onWork }: { youth?: boolean; character?: CharacterId; onProfile: (id: CharacterId) => void; onWork: () => void; onStart: () => void; onPickExample: (text: string) => void; onPickTopic: (text: string) => void; disabled: boolean; maxChars: number }) {
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
      <PhotoCarousel />
    </section>
    <section className="portal-ask" aria-labelledby="portal-ask-title">
      <div><h2 id="portal-ask-title">{t.composeTitle}</h2><p>{t.portal.askHint}</p></div>
      <form onSubmit={event => { event.preventDefault(); if (question.trim() && !disabled) onPickExample(question.trim()) }}>
        <SearchIcon /><input aria-label={t.portal.questionLabel} value={question} onChange={event => setQuestion(event.target.value)} maxLength={maxChars} placeholder={t.portal.questionPlaceholder} />
        <button className="btn btn--primary" disabled={disabled || !question.trim()} type="submit">{t.portal.ask}<SendIcon /></button>
      </form>
      <div className="portal-ask__meta"><span>{t.portal.bilingual}</span><span><MicIcon />{t.portal.voiceAvailable}</span></div>
    </section>
    {youth && <CharacterRoster selected={character} onProfile={onProfile} onWork={onWork} />}
    <section id="topics" className="portal-section" aria-labelledby="topics-title" tabIndex={-1}>
      <div className="section-heading"><div><h2 id="topics-title">{t.portal.topicsTitle}</h2></div>
        <div className="portal-tabs" role="group" aria-label={t.portal.categories}>
          <button aria-pressed={category === 'topics'} onClick={() => setCategory('topics')}>{t.portal.topics}</button>
          <button aria-pressed={category === 'documents'} onClick={() => setCategory('documents')}>{t.portal.documents}</button>
        </div>
      </div>
      <div className="topic-grid">{(category === 'topics' ? t.topicTitles : t.documentTypes).map((title, index) => {
        const TopicIcon = topicIcons[index]
        return <button className="topic-card" key={title} disabled={disabled} aria-label={`${title}: ${category === 'topics' ? t.examples[index] : t.portal.documentQuestions[index]}`} onClick={() => onPickTopic(category === 'topics' ? t.examples[index] : t.portal.documentQuestions[index])}>
          <span className="topic-card__top"><TopicIcon /></span>
          <h3>{title}</h3><p>{category === 'topics' ? t.portal.topicDescriptions[index] : t.portal.documentDescriptions[index]}</p>
          <span className="topic-card__action">{t.portal.exploreTopic}<SendIcon /></span>
        </button>
      })}</div>
    </section>
    <section id="resources" className="portal-section resources-section" aria-labelledby="resources-title" tabIndex={-1}>
      <div className="section-heading"><div><h2 id="resources-title">{t.portal.resources}</h2></div><p className="section-heading__note">{t.portal.resourceHint}</p></div>
      <div className="resource-grid">{resources.map(resource => <a href={resource.url} key={resource.name} target="_blank" rel="noopener noreferrer" className="resource-link">
        <div><strong>{resource.name}</strong><p>{resource.text}</p><span>{new URL(resource.url).hostname}</span></div><ExternalIcon />
      </a>)}</div>
    </section>
    <section id="about" className="portal-section how-section" aria-labelledby="how-title" tabIndex={-1}>
      <div className="section-heading"><div><h2 id="how-title">{t.howTitle}</h2></div></div>
      <ol className="how-steps">{t.stepTitles.map((title, index) => <li key={title}><span>0{index + 1}</span><div><h3>{title}</h3><p>{t.portal.steps[index]}</p></div></li>)}</ol>
    </section>
    <footer className="portal-footer"><div><Wordmark /><p>{t.portalLabel}</p></div><div className="portal-footer__notes"><p>{t.disclaimerStudent}</p><p>{t.disclaimerAi}</p></div></footer>
  </div>
}
