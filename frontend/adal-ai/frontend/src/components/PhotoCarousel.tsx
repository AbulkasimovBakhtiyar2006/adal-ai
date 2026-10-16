import { useEffect, useState, useSyncExternalStore } from 'react'
import { useI18n } from '../i18n/context'
import { experienceCopy } from '../experience/content'
const photos = [
  { src: '/astana.jpg', author: 'Akorda', url: 'https://www.akorda.kz/ru/republic_of_kazakhstan/astana' },
  { src: '/almaty.jpg', author: 'Dauren Nabijan · CC0', url: 'https://commons.wikimedia.org/wiki/File:Almaty_city_skyline.jpg' },
  { src: '/turkistan.jpg', author: 'Petar Milošević · CC BY-SA 3.0', url: 'https://commons.wikimedia.org/wiki/File:Turkistan.jpg' },
]
function subscribeVisibility(listener: () => void) {
  document.addEventListener('visibilitychange', listener)
  return () => document.removeEventListener('visibilitychange', listener)
}
export function PhotoCarousel() {
  const { lang } = useI18n()
  const c = experienceCopy[lang]
  const [index, setIndex] = useState(0)
  const visible = useSyncExternalStore(subscribeVisibility, () => document.visibilityState !== 'hidden')
  useEffect(() => {
    if (!visible) return
    const timer = window.setInterval(() => setIndex(i => (i + 1) % photos.length), 6000)
    return () => window.clearInterval(timer)
  }, [visible])
  return <section className="photo-carousel" aria-label={c.photos}>
    <div className="photo-carousel__frame">
      {photos.map((photo, i) => <img key={photo.src} className={i === index ? 'is-active' : ''} src={photo.src} alt={c.photoAlts[i]} aria-hidden={i !== index} width="1280" height="852" fetchPriority={i === 0 ? 'high' : 'low'} />)}
      <div className="photo-carousel__caption"><h2>{c.photoNames[index]}</h2><p>{c.photoNotes[index]}</p></div>
      <div className="photo-carousel__indicators" aria-hidden="true">{photos.map((photo, i) => <span key={photo.src} className={i === index ? 'is-active' : ''} />)}</div>
    </div>
    <div className="photo-carousel__footer"><a href={photos[index].url} target="_blank" rel="noopener noreferrer">{photos[index].author} ↗</a></div>
  </section>
}
