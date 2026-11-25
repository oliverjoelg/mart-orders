import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { ThemeDef } from '../lib/themes'
import ChristmasScene from './scenes/ChristmasScene'
import SantaMoment from './scenes/SantaMoment'

/**
 * A fun theme's background scene (behind the app) and its occasional "moment" (e.g. Santa's
 * sleigh). Moments are rare and polite: never on the busy screens, never while someone types or
 * scrolls, never in a background tab, and not at all with decorations off or reduced motion.
 */

// screens where people are working fast: no surprises there
const BUSY = ['/desk', '/receive', '/import']
const FIRST_MS = 20_000
const GAP_MS = [70_000, 130_000] as const

export default function ThemeScene({ theme, decor }: { theme: ThemeDef; decor: boolean }) {
  const location = useLocation()
  const [moment, setMoment] = useState(false)
  const lastScroll = useRef(0)
  const path = useRef(location.pathname)
  path.current = location.pathname

  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const enabled = decor && !reduced && !!theme.moment

  const allowedNow = useCallback(() => {
    if (document.hidden) return false
    if (BUSY.some((p) => path.current.startsWith(p))) return false
    if (Date.now() - lastScroll.current < 1500) return false
    const el = document.activeElement
    if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return false
    if (document.querySelector('.modal, .scan-overlay')) return false
    return true
  }, [])

  useEffect(() => {
    const onScroll = () => {
      lastScroll.current = Date.now()
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // schedule moments
  useEffect(() => {
    if (!enabled) {
      setMoment(false)
      return
    }
    let timer = 0
    const plan = (ms: number) => {
      timer = window.setTimeout(() => {
        if (allowedNow()) setMoment(true)
        else plan(15_000) // try again a bit later
      }, ms)
    }
    plan(FIRST_MS)
    const again = () => plan(GAP_MS[0] + Math.random() * (GAP_MS[1] - GAP_MS[0]))
    window.addEventListener('mart:moment-done', again)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('mart:moment-done', again)
    }
  }, [enabled, allowedNow])

  // demo builds: window.__martMoment() shows one now (for checking the animation)
  useEffect(() => {
    if (import.meta.env.MODE !== 'demo' && !import.meta.env.DEV) return
    ;(window as unknown as { __martMoment?: () => void }).__martMoment = () => setMoment(true)
  }, [])

  const done = useCallback(() => {
    setMoment(false)
    window.dispatchEvent(new Event('mart:moment-done'))
  }, [])

  if (!decor || !theme.scene) return null
  return (
    <>
      {theme.scene === 'christmas' && <ChristmasScene />}
      {moment && enabled && theme.moment === 'sleigh' && <SantaMoment onDone={done} />}
    </>
  )
}
