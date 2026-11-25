import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ComponentType } from 'react'
import { useLocation } from 'react-router-dom'
import type { SceneId, ThemeDef } from '../lib/themes'
import { ArcadeMoment, ArcadeScene } from './scenes/arcade'
import { BarbieMoment, BarbieScene } from './scenes/barbie'
import ChristmasScene from './scenes/ChristmasScene'
import { DiwaliMoment, DiwaliScene } from './scenes/diwali'
import { HackerMoment, HackerScene } from './scenes/hacker'
import { HalloweenMoment, HalloweenScene } from './scenes/halloween'
import { HoliMoment, HoliScene } from './scenes/holi'
import SantaMoment from './scenes/SantaMoment'

// the Retro Arcade game loads only when someone presses Play
const NeonDefender = lazy(() => import('./scenes/neonDefender'))

/**
 * A fun theme's background scene (behind the app) and its occasional "moment" (Santa's sleigh,
 * the arcade mini-game, fireworks…). Moments are rare and polite: never on the busy screens,
 * never while someone types or scrolls, never in a background tab or with a pop-up open, and not
 * at all with decorations off or reduced motion.
 */

const SCENES: Record<SceneId, { Scene: ComponentType; Moment: ComponentType<{ onDone(): void }> }> = {
  christmas: { Scene: ChristmasScene, Moment: SantaMoment },
  barbie: { Scene: BarbieScene, Moment: BarbieMoment },
  diwali: { Scene: DiwaliScene, Moment: DiwaliMoment },
  holi: { Scene: HoliScene, Moment: HoliMoment },
  halloween: { Scene: HalloweenScene, Moment: HalloweenMoment },
  arcade: { Scene: ArcadeScene, Moment: ArcadeMoment },
  hacker: { Scene: HackerScene, Moment: HackerMoment },
}

// screens where people are working fast: no surprises there
const BUSY = ['/desk', '/receive', '/import']
const FIRST_MS = 20_000
const GAP_MS = [70_000, 130_000] as const

export default function ThemeScene({ theme, decor }: { theme: ThemeDef; decor: boolean }) {
  const location = useLocation()
  const [moment, setMoment] = useState(0)
  const lastScroll = useRef(0)
  const path = useRef(location.pathname)
  path.current = location.pathname

  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const entry = theme.scene ? SCENES[theme.scene] : null
  const enabled = decor && !reduced && !!entry

  const allowedNow = useCallback(() => {
    if (document.hidden) return false
    if (BUSY.some((p) => path.current.startsWith(p))) return false
    if (Date.now() - lastScroll.current < 1500) return false
    const el = document.activeElement
    if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return false
    if (document.querySelector('.modal, .scan-overlay, .nd-overlay')) return false
    return true
  }, [])

  useEffect(() => {
    const onScroll = () => {
      lastScroll.current = Date.now()
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // schedule moments (a new key each time, so every moment starts fresh)
  useEffect(() => {
    setMoment(0)
    if (!enabled) return
    let timer = 0
    const plan = (ms: number) => {
      timer = window.setTimeout(() => {
        if (allowedNow()) setMoment(Date.now())
        else plan(15_000)
      }, ms)
    }
    plan(FIRST_MS)
    const again = () => plan(GAP_MS[0] + Math.random() * (GAP_MS[1] - GAP_MS[0]))
    window.addEventListener('mart:moment-done', again)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('mart:moment-done', again)
    }
  }, [enabled, allowedNow, theme.id])

  // demo builds: window.__martMoment() shows one now (for checking the animations)
  useEffect(() => {
    if (import.meta.env.MODE !== 'demo' && !import.meta.env.DEV) return
    ;(window as unknown as { __martMoment?: () => void }).__martMoment = () => setMoment(Date.now())
  }, [])

  // Neon Defender: started from the arcade moment's Play button or the theme picker
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    const play = () => {
      setMoment(0)
      setPlaying(true)
    }
    window.addEventListener('mart:play-arcade', play)
    return () => window.removeEventListener('mart:play-arcade', play)
  }, [])
  const game = playing ? (
    <Suspense fallback={null}>
      <NeonDefender onExit={() => setPlaying(false)} />
    </Suspense>
  ) : null

  const done = useCallback(() => {
    setMoment(0)
    window.dispatchEvent(new Event('mart:moment-done'))
  }, [])

  if (!decor || !entry) return game
  const { Scene, Moment } = entry
  return (
    <>
      {game}
      <Scene />
      {moment > 0 && enabled && <Moment key={moment} onDone={done} />}
    </>
  )
}
