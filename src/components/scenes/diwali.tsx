import { useEffect, useMemo, useState } from 'react'
import { bump, Pops, rand, usePops, useTimers } from './util'

/**
 * Diwali. Scene: stars, slowly turning rangoli in the corners, and a row of flickering diyas
 * glowing along the bottom (the string of lights stays on top). Moment: rockets launch and burst
 * into fireworks — tap one mid-flight for an extra-big chakra burst.
 */

const SPARK = ['#ffb020', '#ffe066', '#ff5e3a', '#ff8fc8', '#7cf29a', '#7fd3ff']

function Rangoli({ size }: { size: number }) {
  const petals = Array.from({ length: 12 }, (_, i) => i * 30)
  return (
    <svg width={size} height={size} viewBox="-100 -100 200 200">
      {petals.map((a) => (
        <path key={`o${a}`} d="M0 -92 C 18 -70, 18 -48, 0 -36 C -18 -48, -18 -70, 0 -92 Z" fill="#ff5e3a" transform={`rotate(${a})`} opacity="0.9" />
      ))}
      {petals.map((a) => (
        <path key={`m${a}`} d="M0 -62 C 12 -50, 12 -36, 0 -26 C -12 -36, -12 -50, 0 -62 Z" fill="#ffb020" transform={`rotate(${a + 15})`} />
      ))}
      <circle r="24" fill="#ff8fc8" />
      <circle r="14" fill="#ffe066" />
      <circle r="6" fill="#7fd3ff" />
    </svg>
  )
}

function Diya({ x }: { x: number }) {
  return (
    <g transform={`translate(${x} 150)`}>
      <ellipse cx="0" cy="-18" rx="18" ry="22" fill="#ffb347" opacity="0.25" className="dw-glow" />
      <path d="M0 -34 C 6 -24, 5 -16, 0 -12 C -5 -16, -6 -24, 0 -34 Z" fill="#ffd36b" className="dw-flame" />
      <path d="M0 -28 C 3 -22, 2 -18, 0 -16 C -2 -18, -3 -22, 0 -28 Z" fill="#fff4c2" className="dw-flame" />
      <path d="M-22 -12 Q 0 -4 22 -12 Q 20 6 0 8 Q -20 6 -22 -12 Z" fill="#b5502a" />
      <path d="M-22 -12 Q 0 -4 22 -12" stroke="#e8894b" strokeWidth="2" fill="none" />
      <circle cx="-8" cy="0" r="1.6" fill="#ffd36b" />
      <circle cx="0" cy="2" r="1.6" fill="#ffd36b" />
      <circle cx="8" cy="0" r="1.6" fill="#ffd36b" />
    </g>
  )
}

export function DiwaliScene() {
  const stars = useMemo(() => Array.from({ length: 24 }, (_, i) => ({ i, l: rand(i + 11) * 100, t: rand(i + 60) * 55, s: 1 + rand(i + 3) * 2, d: -rand(i + 7) * 4 })), [])
  return (
    <div className="scene scene-diwali" aria-hidden>
      {stars.map((s) => (
        <span key={s.i} className="scene-star" style={{ left: `${s.l}%`, top: `${s.t}%`, width: s.s, height: s.s, animationDelay: `${s.d}s` }} />
      ))}
      <span className="dw-rangoli dw-r1">
        <Rangoli size={260} />
      </span>
      <span className="dw-rangoli dw-r2">
        <Rangoli size={200} />
      </span>
      <svg className="scene-ground dw-diyas" viewBox="0 0 1440 170" preserveAspectRatio="xMidYMax slice">
        <rect x="0" y="150" width="1440" height="20" fill="#2a1a4f" />
        {Array.from({ length: 13 }, (_, i) => (
          <Diya key={i} x={60 + i * 110} />
        ))}
      </svg>
    </div>
  )
}

interface Rocket {
  id: number
  x: number
  peak: number
  colour: string
  burst: boolean
  big: boolean
}

export function DiwaliMoment({ onDone }: { onDone(): void }) {
  const [rockets, setRockets] = useState<Rocket[]>([])
  const later = useTimers()
  const { pops, add } = usePops()

  useEffect(() => {
    for (let i = 0; i < 6; i++) {
      later(() => {
        const r: Rocket = { id: i, x: 8 + rand(i * 5 + 2) * 84, peak: 18 + rand(i + 30) * 22, colour: SPARK[i % SPARK.length], burst: false, big: false }
        setRockets((list) => [...list, r])
        later(() => setRockets((list) => list.map((q) => (q.id === i && !q.burst ? { ...q, burst: true } : q))), 1500)
      }, 200 + i * 900)
    }
    later(onDone, 200 + 6 * 900 + 3500)
  }, [later, onDone])

  const tap = (r: Rocket, e: React.PointerEvent) => {
    if (r.burst) return
    const n = bump('mart-fireworks')
    setRockets((list) => list.map((q) => (q.id === r.id ? { ...q, burst: true, big: true } : q)))
    add(e.clientX, e.clientY, `Chakra! 🎆 ${n}`, '#b5502a')
  }

  return (
    <div className="moment moment-diwali" aria-hidden>
      {rockets.map((r) => (
        <span
          key={r.id}
          className={`dw-rocket${r.burst ? ' burst' : ''}${r.big ? ' big' : ''}`}
          style={{ left: `${r.x}%`, ['--peak' as string]: `${r.peak}vh`, ['--c' as string]: r.colour }}
          onPointerDown={(e) => tap(r, e)}
        >
          {!r.burst && <i className="dw-shell" />}
          {r.burst &&
            Array.from({ length: r.big ? 28 : 18 }, (_, j) => (
              <i key={j} className="dw-spark" style={{ ['--a' as string]: `${(360 / (r.big ? 28 : 18)) * j}deg`, background: SPARK[(j + r.id) % SPARK.length] }} />
            ))}
        </span>
      ))}
      <Pops pops={pops} />
    </div>
  )
}
