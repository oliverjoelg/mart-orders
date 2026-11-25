import { useEffect, useMemo, useState } from 'react'
import { bump, Pops, rand, usePops, useTimers } from './util'

/**
 * Barbie. Scene: pink sunset, a little pink beach house with palm trees, soft hearts drifting up.
 * Moment: a pink convertible zooms along the bottom ("beep beep!") leaving a trail of hearts —
 * tap them to collect.
 */

function Heart({ size, fill }: { size: number; fill: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path d="M12 21 C 5 15, 1 11, 1 7 a5.5 5.5 0 0 1 11 -1.5 A5.5 5.5 0 0 1 23 7 c0 4 -4 8 -11 14 Z" fill={fill} />
    </svg>
  )
}

function Palm({ x, flip }: { x: number; flip?: boolean }) {
  return (
    <g transform={`translate(${x} 150) scale(${flip ? -1 : 1} 1)`}>
      <path d="M0 0 C 4 -30, 2 -60, 10 -88" stroke="#c2457f" strokeWidth="6" fill="none" strokeLinecap="round" />
      <path d="M10 -88 q-30 -10 -46 8 q22 -6 46 -8 Z M10 -88 q28 -14 48 4 q-24 -4 -48 -4 Z M10 -88 q-10 -26 -34 -30 q18 12 34 30 Z M10 -88 q14 -26 38 -26 q-20 10 -38 26 Z" fill="#e0559a" />
    </g>
  )
}

export function BarbieScene() {
  const hearts = useMemo(() => Array.from({ length: 12 }, (_, i) => ({ i, l: rand(i + 7) * 100, d: -rand(i + 70) * 22, dur: 16 + rand(i + 33) * 14, s: 12 + rand(i + 5) * 18 })), [])
  return (
    <div className="scene scene-barbie" aria-hidden>
      <div className="bb-sun" />
      {hearts.map((h) => (
        <span key={h.i} className="bb-float" style={{ left: `${h.l}%`, animationDelay: `${h.d}s`, animationDuration: `${h.dur}s` }}>
          <Heart size={h.s} fill="#ff8fc8" />
        </span>
      ))}
      <svg className="scene-ground bb-beach" viewBox="0 0 1440 200" preserveAspectRatio="xMidYMax slice">
        <path d="M0 120 C 240 95, 480 135, 720 115 S 1200 95, 1440 120 L1440 200 L0 200 Z" fill="#ffb3d6" opacity="0.7" />
        <path d="M0 150 C 300 130, 600 170, 900 150 S 1300 135, 1440 150 L1440 200 L0 200 Z" fill="#ffd1e6" />
        <Palm x={160} />
        <Palm x={1260} flip />
        <g transform="translate(980 96)">
          <rect x="0" y="20" width="110" height="56" rx="4" fill="#ffffff" />
          <path d="M-10 24 L55 -14 L120 24 Z" fill="#e0559a" />
          <rect x="44" y="44" width="22" height="32" rx="11" fill="#ff8fc8" />
          <path d="M20 36 m0 3 a5 5 0 0 1 8 -4 a5 5 0 0 1 8 4 c0 5 -8 10 -8 10 c0 0 -8 -5 -8 -10 Z" fill="#d0147a" />
          <path d="M74 36 m0 3 a5 5 0 0 1 8 -4 a5 5 0 0 1 8 4 c0 5 -8 10 -8 10 c0 0 -8 -5 -8 -10 Z" fill="#d0147a" />
        </g>
      </svg>
    </div>
  )
}

interface Trail {
  id: number
  x: number
  y: number
  caught: boolean
}

export function BarbieMoment({ onDone }: { onDone(): void }) {
  const [trail, setTrail] = useState<Trail[]>([])
  const later = useTimers()
  const { pops, add } = usePops()
  const DRIVE_MS = 6500

  useEffect(() => {
    const w = window.innerWidth
    for (let i = 0; i < 12; i++) {
      const t = 500 + i * 450
      later(() => {
        const x = (t / DRIVE_MS) * (w + 260) - 260 + 20
        if (x > 0 && x < w - 20) setTrail((list) => [...list, { id: i, x, y: 0, caught: false }])
      }, t)
    }
    later(onDone, DRIVE_MS + 2600)
  }, [later, onDone])

  const collect = (h: Trail, e: React.PointerEvent) => {
    if (h.caught) return
    const n = bump('mart-hearts')
    setTrail((list) => list.map((x) => (x.id === h.id ? { ...x, caught: true } : x)))
    add(e.clientX, e.clientY, `+1 💖 ${n}`, '#d0147a')
  }

  return (
    <div className="moment moment-barbie" aria-hidden>
      <div className="bb-car" style={{ animationDuration: `${DRIVE_MS}ms` }}>
        <span className="bb-beep">beep beep! 💖</span>
        <svg width="210" height="80" viewBox="0 0 210 80">
          <path d="M14 52 Q 16 34 44 32 L 76 30 Q 92 12 122 12 L 150 14 Q 166 26 176 34 Q 200 36 202 52 Q 200 60 192 60 L 22 60 Q 12 60 14 52 Z" fill="#ff3ea5" />
          <path d="M96 28 Q 106 16 124 16 L 132 30 Z" fill="#bfe9ff" opacity="0.85" />
          <circle cx="112" cy="20" r="7" fill="#f6d36b" />
          <path d="M105 18 q-10 2 -16 10" stroke="#f6d36b" strokeWidth="4" fill="none" strokeLinecap="round" className="bb-hair" />
          <path d="M24 44 H 190" stroke="#ffffff" strokeWidth="3" opacity="0.7" />
          <g className="bb-wheel" style={{ transformOrigin: '50px 60px' }}>
            <circle cx="50" cy="60" r="13" fill="#3d0d26" />
            <circle cx="50" cy="60" r="6" fill="#ffffff" />
            <path d="M50 54 V66 M44 60 H56" stroke="#ff3ea5" strokeWidth="2" />
          </g>
          <g className="bb-wheel" style={{ transformOrigin: '164px 60px' }}>
            <circle cx="164" cy="60" r="13" fill="#3d0d26" />
            <circle cx="164" cy="60" r="6" fill="#ffffff" />
            <path d="M164 54 V66 M158 60 H170" stroke="#ff3ea5" strokeWidth="2" />
          </g>
        </svg>
      </div>
      {trail.map((h) => (
        <span key={h.id} className={`bb-trail${h.caught ? ' caught' : ''}`} style={{ left: h.x }} onPointerDown={(e) => collect(h, e)}>
          <Heart size={26} fill={h.id % 2 ? '#ff3ea5' : '#ff8fc8'} />
        </span>
      ))}
      <Pops pops={pops} />
    </div>
  )
}
