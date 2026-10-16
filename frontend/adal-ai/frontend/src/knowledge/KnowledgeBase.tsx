import { useEffect, useMemo, useState } from 'react'
import { getKnowledge, type KnowledgeBase as Knowledge, type KnowledgeDocument } from '../api/client'
import { useI18n } from '../i18n/context'
import { ExternalIcon, SearchIcon } from '../components/Icons'
import { knowledgeCopy, type KnowledgeCopy } from './copy'

type LangFilter = 'all' | 'ru' | 'kk'
type Load = { phase: 'loading' } | { phase: 'error' } | { phase: 'ready'; data: Knowledge }

const host = (url: string) => new URL(url).hostname.replace(/^www\./, '')

function DocumentList({ docs, c }: { docs: KnowledgeDocument[]; c: KnowledgeCopy }) {
  return <ul className="kb-docs">{docs.map(doc => <li key={doc.id}>
    <a href={doc.url} target="_blank" rel="noopener noreferrer" className="kb-doc">
      <span className="kb-doc__lang">{doc.language.toUpperCase()}</span>
      <span className="kb-doc__body"><strong>{doc.title}</strong>
        <small>{host(doc.url)}{doc.verified_at && ` · ${c.verified} ${doc.verified_at}`}</small></span>
      <span className={`kb-badge kb-badge--${doc.status}`}>{c.status[doc.status]}</span>
      <ExternalIcon />
    </a>
  </li>)}</ul>
}

function Group({ id, title, hint, docs, c }: { id: string; title: string; hint: string; docs: KnowledgeDocument[]; c: KnowledgeCopy }) {
  if (!docs.length) return null
  return <section className="kb-group" aria-labelledby={`kb-${id}`}>
    <div className="section-heading"><div><h2 id={`kb-${id}`}>{title} <span className="kb-count">{docs.length}</span></h2></div><p className="section-heading__note">{hint}</p></div>
    <DocumentList docs={docs} c={c} />
  </section>
}

export function KnowledgeBase({ onHome }: { onHome: () => void }) {
  const { lang } = useI18n()
  const c = knowledgeCopy[lang]
  const [load, setLoad] = useState<Load>({ phase: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState('')
  const [langFilter, setLangFilter] = useState<LangFilter>('all')

  useEffect(() => {
    let alive = true
    getKnowledge().then(data => { if (alive) setLoad({ phase: 'ready', data }) }, () => { if (alive) setLoad({ phase: 'error' }) })
    return () => { alive = false }
  }, [attempt])

  const docs = useMemo(() => {
    if (load.phase !== 'ready') return []
    const needle = query.trim().toLowerCase()
    return load.data.documents.filter(doc => (langFilter === 'all' || doc.language === langFilter) && (!needle || doc.title.toLowerCase().includes(needle)))
  }, [load, query, langFilter])

  return <div className="games-scroll kb-scroll"><div className="games kb">
    <div className="games-intro"><p className="eyebrow"><span />{c.eyebrow}</p><h1>{c.title}</h1><p>{c.intro}</p></div>
    {load.phase === 'loading' && <p className="kb-state" role="status">{c.loading}</p>}
    {load.phase === 'error' && <div className="kb-state" role="alert"><p>{c.failed}</p><button className="btn btn--secondary" onClick={() => { setLoad({ phase: 'loading' }); setAttempt(n => n + 1) }}>{c.retry}</button></div>}
    {load.phase === 'ready' && <>
      <div className="kb-stats">
        <div><strong>{load.data.documents.length}</strong><span>{c.statDocuments}</span></div>
        <div><strong>{load.data.documents.filter(doc => doc.status === 'indexed').length}</strong><span>{c.statIndexed}</span></div>
        <div><strong>{load.data.sites.length}</strong><span>{c.statSites}</span></div>
      </div>
      <section className="kb-how" aria-labelledby="kb-how">
        <h2 id="kb-how">{c.howTitle}</h2>
        <p>{load.data.mode === 'verified' ? c.modeVerified : load.data.web_search ? c.modeSearch : c.modeSearchOff}</p>
        {load.data.models.length > 0 && <p className="kb-models"><span>{c.models}:</span>{load.data.models.map(model => <span key={model} className="kb-chip">{model}</span>)}</p>}
      </section>
      <div className="kb-filters">
        <label className="kb-search"><SearchIcon /><span className="visually-hidden">{c.search}</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={c.search} /></label>
        <div className="game-pills kb-langs" role="group" aria-label={c.search}>{(['all', 'ru', 'kk'] as const).map(id => <label key={id}>
          <input type="radio" name="kb-lang" checked={langFilter === id} onChange={() => setLangFilter(id)} /><span>{id === 'all' ? c.all : id.toUpperCase()}</span>
        </label>)}</div>
      </div>
      {!docs.length && <p className="kb-state">{c.empty}</p>}
      <Group id="laws" title={c.laws} hint={c.lawsHint} docs={docs.filter(doc => doc.kind === 'adilet')} c={c} />
      <Group id="akorda" title={c.akorda} hint={c.akordaHint} docs={docs.filter(doc => doc.kind === 'akorda')} c={c} />
      <Group id="uploaded" title={c.uploaded} hint={c.uploadedHint} docs={docs.filter(doc => doc.kind === 'uploaded')} c={c} />
      {load.data.topics.length > 0 && <section className="kb-group" aria-labelledby="kb-topics">
        <div className="section-heading"><div><h2 id="kb-topics">{c.topics}</h2></div><p className="section-heading__note">{c.topicsHint}</p></div>
        <div className="kb-topics">{load.data.topics.map(topic => <div key={topic.id} className="kb-topic"><h3>{topic.title}</h3>
          <ul>{topic.urls.map(url => <li key={url}><a href={url} target="_blank" rel="noopener noreferrer">{host(url)}{new URL(url).pathname.length > 1 && <small>{new URL(url).pathname}</small>}</a></li>)}</ul>
        </div>)}</div>
      </section>}
      <section className="kb-group" aria-labelledby="kb-sites">
        <div className="section-heading"><div><h2 id="kb-sites">{c.sites} <span className="kb-count">{load.data.sites.length}</span></h2></div><p className="section-heading__note">{c.sitesHint}</p></div>
        <div className="resource-grid kb-sites">{load.data.sites.map(site => <a key={site.host} href={site.url} target="_blank" rel="noopener noreferrer" className="resource-link">
          <div><strong>{site.host}</strong><p>{site.title}</p><span>{c.open}</span></div><ExternalIcon />
        </a>)}</div>
      </section>
    </>}
    <button className="text-button games-home" onClick={onHome}>← {c.back}</button>
  </div></div>
}
