/** Custom geometric lettering, drawn as paths so the wordmark needs no web font. */
export function Wordmark() {
  return <svg className="wordmark" viewBox="0 0 168 42" role="img" aria-label="Adal AI" fill="none">
    <g stroke="currentColor" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 34 17 7q2-4 4 0l13 27M10 23h17" />
      <path d="M61 5v29M61 23a10 10 0 1 0-20 0 10 10 0 0 0 20 0" />
      <path d="M90 34V23a10 10 0 1 0-10 10q7 0 10-7" />
      <path d="M103 5v23q0 6 7 6" />
    </g>
    <rect x="123" y="6" width="44" height="31" rx="8" fill="currentColor" className="wordmark__tile" />
    <path d="m132 28 5-13 5 13m-8-4h6m10-9v13" stroke="var(--accent-contrast)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="m115 3 1.3 3.5L120 8l-3.7 1.5L115 13l-1.3-3.5L110 8l3.7-1.5Z" fill="#b18d4e" />
  </svg>
}
