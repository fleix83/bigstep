import { useEffect, useState } from 'react'

export const isTauri = '__TAURI_INTERNALS__' in window

const MOBILE_QUERY = '(max-width: 767px)'

/** true unterhalb des md-Breakpoints (Smartphone-Layout). */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY)
    const onChange = () => setMobile(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return mobile
}

/**
 * Read-only-Modus (PRD F6): auf Smartphone-Viewports ausserhalb der
 * Tauri-App werden sämtliche Editier-Controls NICHT gerendert (nicht nur
 * versteckt). Die Desktop-Browser-Ansicht bleibt editierbar.
 */
export function useReadOnly(): boolean {
  const mobile = useIsMobile()
  return mobile && !isTauri
}
