import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { Lang } from '../api/types'
import { VoiceController } from './VoiceController'
import { playCloudSpeech } from './cloudSpeech'

export function useVoice(lang: Lang, maxChars: number, scope: string, cloudEnabled = false) {
  const { controller } = useMemo(() => ({ scope, controller: new VoiceController(lang, maxChars, cloudEnabled ? playCloudSpeech : undefined) }), [lang, maxChars, scope, cloudEnabled])
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  useEffect(() => {
    const hide = () => { if (document.hidden) controller.end() }
    document.addEventListener('visibilitychange', hide)
    window.addEventListener('pagehide', controller.end)
    window.addEventListener('offline', controller.end)
    return () => {
      document.removeEventListener('visibilitychange', hide)
      window.removeEventListener('pagehide', controller.end)
      window.removeEventListener('offline', controller.end)
      controller.end()
    }
  }, [controller])
  return { controller, state }
}
