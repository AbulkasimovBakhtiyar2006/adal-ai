import { useId, useState } from 'react'
import { useI18n } from '../i18n/context'
import { characterIds, experienceCopy, type CharacterId } from '../experience/content'
import { ExperienceDialog } from './ExperienceDialog'
import { SendIcon } from './Icons'
import { CharacterQuiz } from './CharacterQuiz'
import { quizCopy } from '../quiz/content'
import { QUIZ_LENGTH, rankLevel, readBest } from '../quiz/game'
export function CharacterRoster({ selected, onProfile, onWork }: { selected: CharacterId; onProfile: (id: CharacterId) => void; onWork: () => void }) {
  const { lang } = useI18n()
  const c = experienceCopy[lang]
  return <section className="character-section" aria-labelledby="characters-title">
    <div className="section-heading"><div><h2 id="characters-title">{c.rosterTitle}</h2><p className="character-section__intro">{c.rosterIntro}</p></div><button className="text-button" onClick={onWork}>{c.backToWork} ↗</button></div>
    <div className="character-grid">{characterIds.map(id => {
      const person = c.characters[id]
      const best = readBest(id)
      return <button key={id} className={`character-card character-card--${id}`} aria-label={`${c.profile}: ${person.name}`} onClick={() => onProfile(id)}>
        <div className="character-card__portrait"><img src={`/characters/${id}.jpg`} alt="" width="600" height="900" loading="lazy" />{selected === id && <span className="character-card__label">✓ {c.selected}</span>}</div>
        <div className="character-card__info"><span>{person.shortRole}</span><h3>{person.name}<SendIcon /></h3><p>«{person.quote}»</p><div className="character-card__tags">{person.tags.slice(0, 2).map(tag => <span key={tag}>{tag}</span>)}</div><span className="character-card__quiz">{quizCopy[lang].title} · {QUIZ_LENGTH} {lang === 'ru' ? 'вопросов' : 'сұрақ'} →</span>{best !== null && <span className="quiz-badge">{quizCopy[lang].ranks[id][rankLevel(best)]} · {best}/{QUIZ_LENGTH}</span>}</div>
      </button>
    })}</div>
    <p className="character-section__note">{c.cosmetic}</p>
  </section>
}
export function CharacterProfile({ id, selected, onSelect, onQuestion, onClose, disabled }: { id: CharacterId; selected: CharacterId; onSelect: (id: CharacterId) => void; onQuestion: (question: string) => void; onClose: () => void; disabled: boolean }) {
  const { lang } = useI18n()
  const c = experienceCopy[lang]
  const person = c.characters[id]
  const titleId = useId()
  const [playing, setPlaying] = useState(false)
  const qc = quizCopy[lang]
  const best = readBest(id)
  return <ExperienceDialog titleId={titleId} onClose={onClose} className={`character-profile character-card--${id}`}>
    {playing ? <CharacterQuiz id={id} titleId={titleId} onBack={() => setPlaying(false)} /> : <div className="profile-layout"><div className="profile-portrait"><img src={`/characters/${id}.jpg`} alt={person.name} width="600" height="900" /></div>
      <div className="profile-copy"><p className="eyebrow">{c.profile}</p><h2 id={titleId}>{person.name}</h2><p className="profile-role">{person.role}</p><blockquote>«{person.quote}»</blockquote><h3>{c.about}</h3><p>{person.description}</p><h3>{c.topics}</h3><div className="character-card__tags">{person.tags.map(tag => <span key={tag}>{tag}</span>)}</div>
        <button className="btn btn--primary profile-select" onClick={() => onSelect(id)}>{selected === id ? `✓ ${c.selected}` : c.select}</button>
        <section className="profile-quiz"><p className="eyebrow">{qc.intro}</p><h3>{qc.title}</h3><p>{qc.description}</p><p className="profile-note">{qc.rules}</p>{best !== null && <p className="quiz-badge">{qc.ranks[id][rankLevel(best)]} · {best}/{QUIZ_LENGTH}</p>}<button className="btn btn--secondary" onClick={() => setPlaying(true)}>{qc.start} →</button></section>
        <h3>{c.start}</h3><button className="profile-question" disabled={disabled} onClick={() => { onSelect(id); onQuestion(person.question); onClose() }}>{person.question}<SendIcon /></button><p className="profile-note">{c.cosmetic}</p>
      </div></div>}
  </ExperienceDialog>
}
export function CharacterCompanion({ id, onProfile, onSettings }: { id: CharacterId; onProfile: (id: CharacterId) => void; onSettings: () => void }) {
  const { lang } = useI18n()
  const c = experienceCopy[lang]
  const person = c.characters[id]
  return <div className={`character-companion character-card--${id}`}><button onClick={() => onProfile(id)} aria-label={`${c.profile}: ${person.name}`}><img src={`/characters/${id}.jpg`} alt="" /><span><small>{c.selected}</small><strong>{person.name}<span> · {person.shortRole}</span></strong></span></button><button className="text-button" onClick={onSettings}>{c.change}</button></div>
}
