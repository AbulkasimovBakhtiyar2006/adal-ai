import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/context'
import { experienceCopy, type CharacterId } from '../experience/content'
import { quizCopy, quizSources } from '../quiz/content'
import { createRound, QUIZ_LENGTH, rankLevel, saveBest } from '../quiz/game'

export function CharacterQuiz({ id, titleId, onBack }: { id: CharacterId; titleId: string; onBack: () => void }) {
  const { lang } = useI18n()
  const c = quizCopy[lang]
  const person = experienceCopy[lang].characters[id]
  const [questions, setQuestions] = useState(() => createRound(id))
  const [answers, setAnswers] = useState<number[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [index, setIndex] = useState(0)
  const [result, setResult] = useState<{ best: number; saved: boolean } | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const action = useRef<HTMLButtonElement>(null)
  const question = questions[index]
  const answered = answers.length > index
  const score = answers.reduce((total, answer, i) => total + Number(answer === questions[i].correct), 0)

  useEffect(() => { heading.current?.focus(); heading.current?.closest('dialog')?.scrollTo({ top: 0 }) }, [index, result, questions])
  useEffect(() => { if (answered) action.current?.focus() }, [answered])

  const restart = () => { setQuestions(createRound(id)); setAnswers([]); setSelected(null); setIndex(0); setResult(null) }
  const next = () => {
    if (!answered) return
    if (index === QUIZ_LENGTH - 1) setResult(saveBest(id, score))
    else { setIndex(index + 1); setSelected(null) }
  }
  return <div className="character-quiz">
    <div className="quiz-person"><img src={`/characters/${id}.jpg`} alt="" /><div><p className="eyebrow">{c.title} · {person.name}</p><p>{person.shortRole}</p></div></div>
    {result ? <>
      <h2 id={titleId} ref={heading} tabIndex={-1}>{c.result}</h2>
      <div className="quiz-result"><span className="quiz-result__score">{score}<small> / {QUIZ_LENGTH}</small></span><p>{c.earned}</p><h3>{c.ranks[id][rankLevel(score)]}</h3><p>{c.gameNote}</p></div>
      <p className="quiz-best">{c.best}: {result.best} / {QUIZ_LENGTH} · {c.ranks[id][rankLevel(result.best)]}</p>
      <p className="profile-note" role="status">{result.saved ? c.saved : c.unsaved}</p>
      <div className="quiz-actions"><button className="btn btn--primary" onClick={restart}>{c.retry}</button><button className="btn btn--secondary" onClick={onBack}>{c.back}</button></div>
      <details className="quiz-review"><summary>{c.review}</summary><ol>{questions.map((item, i) => <li key={item.id}>
        <h3>{item.text[lang]}</h3><p>{answers[i] === item.correct ? `✓ ${c.correct}` : `✕ ${c.yourAnswer}: ${item.options[answers[i]][lang]}`}</p>
        <p><strong>{c.rightAnswer}:</strong> {item.options[item.correct][lang]}</p><p>{item.explanation[lang]}</p>
      </li>)}</ol></details>
      <div className="quiz-sources"><span>{c.sources}:</span>{quizSources[id].map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a>)}</div>
    </> : <>
      <div className="quiz-progress"><span>{c.question} {index + 1} / {QUIZ_LENGTH}</span><span>{person.name}</span><progress aria-label={c.title} value={answers.length} max={QUIZ_LENGTH} /></div>
      <h2 id={titleId} ref={heading} tabIndex={-1}>{question.text[lang]}</h2>
      <form onSubmit={event => { event.preventDefault(); if (!answered && selected !== null) setAnswers([...answers, selected]) }}>
        <fieldset className="quiz-options" disabled={answered} aria-labelledby={titleId}>
          {question.options.map((option, optionIndex) => <label key={`${question.id}-${optionIndex}`} className={`quiz-option ${answered && optionIndex === question.correct ? 'quiz-option--correct' : ''} ${answered && optionIndex === selected && selected !== question.correct ? 'quiz-option--incorrect' : ''}`}>
            <input type="radio" name="quiz-answer" checked={selected === optionIndex} onChange={() => setSelected(optionIndex)} value={optionIndex} />
            <span>{option[lang]}</span>{answered && (optionIndex === question.correct || optionIndex === selected) && <strong aria-hidden="true">{optionIndex === question.correct ? '✓' : '✕'}</strong>}
          </label>)}
        </fieldset>
        {!answered && <button className="btn btn--primary quiz-submit" type="submit" disabled={selected === null}>{c.check}</button>}
      </form>
      {answered && <><div className="quiz-feedback" role="status"><strong>{answers[index] === question.correct ? c.correct : c.incorrect}</strong><p>{c.rightAnswer}: {question.options[question.correct][lang]}</p><p>{question.explanation[lang]}</p></div><button ref={action} className="btn btn--primary quiz-submit" onClick={next}>{index === QUIZ_LENGTH - 1 ? c.finish : c.next}</button></>}
    </>}
  </div>
}
