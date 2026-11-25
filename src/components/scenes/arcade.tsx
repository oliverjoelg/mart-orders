import { useEffect, useMemo, useRef, useState } from 'react'
import { bump, Pops, rand, readNumber, usePops, useTimers } from './util'

/**
 * Retro Arcade. Scene: synthwave sun cut by stripes, neon mountains, a grid floor rolling toward
 * you, stars. Moment: a ~12 s mini-game — neon cubes rain down while your ship sweeps the bottom
 * firing lasers; tap cubes to blast them (+100), high score kept on this device. Its Play button
 * opens the full game, Neon Defender.
 * (Original artwork; not a copy of any real game.)
 */

export function ArcadeScene() {
  const stars = useMemo(() => Array.from({ length: 30 }, (_, i) => ({ i, l: rand(i + 3) * 100, t: rand(i + 40) * 40, s: 1 + rand(i + 80) * 2, d: -rand(i + 9) * 3 })), [])
  return (
    <div className="scene scene-arcade" aria-hidden>
      {stars.map((s) => (
        <span key={s.i} className="arc-star" style={{ left: `${s.l}%`, top: `${s.t}%`, width: s.s, height: s.s, animationDelay: `${s.d}s` }} />
      ))}
      <div className="arc-horizon">
        <div className="arc-sun" />
        <svg className="arc-mountains" viewBox="0 0 1440 160" preserveAspectRatio="none">
          <path d="M0 160 L120 70 L210 120 L330 30 L470 120 L560 80 L650 140 L760 60 L880 130 L1000 40 L1120 120 L1220 75 L1330 125 L1440 60 L1440 160 Z" fill="#12032e" stroke="#21e6ff" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="arc-floor">
        <div className="arc-grid" />
      </div>
    </div>
  )
}

interface Cube {
  id: number
  x: number
  dur: number
  hue: string
  hit: boolean
}
interface Laser {
  id: number
  x: number
}

const GAME_MS = 12_000
const HI_KEY = 'mart-arcade-hi'
const HUES = ['#ff2fb9', '#21e6ff', '#ffe14d', '#9d5cff']

export function ArcadeMoment({ onDone }: { onDone(): void }) {
  const [cubes, setCubes] = useState<Cube[]>([])
  const [lasers, setLasers] = useState<Laser[]>([])
  const [score, setScore] = useState(0)
  const [phase, setPhase] = useState<'ready' | 'play' | 'over'>('ready')
  const [hi, setHi] = useState(() => readNumber(HI_KEY))
  const scoreRef = useRef(0)
  const ship = useRef<HTMLDivElement>(null)
  const shipX = useRef(0)
  const later = useTimers()
  const { pops, add } = usePops()

  // the ship sweeps left and right along the bottom
  useEffect(() => {
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      const w = window.innerWidth
      const p = 0.5 - 0.5 * Math.cos(((now - t0) / 3800) * Math.PI * 2)
      shipX.current = 40 + p * (w - 120)
      if (ship.current) ship.current.style.transform = `translate3d(${shipX.current}px, 0, 0)`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    later(() => setPhase('play'), 1200)
    for (let i = 0; i < 10; i++) {
      later(() => {
        setCubes((c) => [...c, { id: i, x: 6 + rand(i + Date.now() % 97) * 86, dur: 4.6 + rand(i + 5) * 2, hue: HUES[i % HUES.length], hit: false }])
      }, 1300 + i * 850)
    }
    // lasers from wherever the ship is
    for (let k = 0; k < 22; k++) {
      later(() => {
        const id = 1000 + k
        setLasers((l) => [...l, { id, x: shipX.current + 18 }])
        later(() => setLasers((l) => l.filter((q) => q.id !== id)), 650)
      }, 1300 + k * 480)
    }
    later(() => {
      setPhase('over')
      const best = Math.max(readNumber(HI_KEY), scoreRef.current)
      try {
        localStorage.setItem(HI_KEY, String(best))
      } catch {
        /* private mode */
      }
      setHi(best)
    }, GAME_MS)
    later(onDone, GAME_MS + 1800)
  }, [later, onDone])

  const blast = (c: Cube, e: React.PointerEvent) => {
    if (c.hit) return
    scoreRef.current += 100
    setScore(scoreRef.current)
    bump('mart-arcade-blasts')
    setCubes((list) => list.map((x) => (x.id === c.id ? { ...x, hit: true } : x)))
    add(e.clientX, e.clientY, '+100', c.hue)
  }

  return (
    <div className="moment moment-arcade" aria-hidden>
      <div className="arc-hud">
        <span>SCORE {String(score).padStart(4, '0')}</span>
        <span>HI {String(Math.max(hi, score)).padStart(4, '0')}</span>
      </div>
      <button
        type="button"
        className="arc-play"
        onClick={() => {
          window.dispatchEvent(new Event('mart:play-arcade'))
          onDone()
        }}
      >
        ▶ PLAY NEON DEFENDER
      </button>
      {phase === 'ready' && <div className="arc-banner">PLAYER 1 READY</div>}
      {phase === 'over' && (
        <div className="arc-banner">
          GAME OVER
          <small>{score ? `${score} points${score >= hi ? ' · new high score!' : ''}` : 'tap the cubes next time'}</small>
        </div>
      )}
      {cubes.map((c) => (
        <span
          key={c.id}
          className={`arc-cube${c.hit ? ' hit' : ''}`}
          style={{ left: `${c.x}%`, animationDuration: `${c.dur}s`, ['--hue' as string]: c.hue }}
          onPointerDown={(e) => blast(c, e)}
        >
          {c.hit &&
            Array.from({ length: 8 }, (_, j) => (
              <i key={j} style={{ ['--a' as string]: `${j * 45}deg` }} />
            ))}
        </span>
      ))}
      {lasers.map((l) => (
        <span key={l.id} className="arc-laser" style={{ left: l.x }} />
      ))}
      <div className="arc-ship" ref={ship}>
        <svg width="44" height="40" viewBox="0 0 44 40">
          <path d="M22 2 L30 22 L42 30 L42 36 L28 32 L22 38 L16 32 L2 36 L2 30 L14 22 Z" fill="#160536" stroke="#21e6ff" strokeWidth="2" strokeLinejoin="round" />
          <path d="M22 10 L26 22 L22 26 L18 22 Z" fill="#ff2fb9" />
          <path d="M18 38 L22 46 L26 38" fill="#ffe14d" className="arc-flame" />
        </svg>
      </div>
      <Pops pops={pops} />
    </div>
  )
}
