import { useEffect, useRef, useState } from 'react'

/**
 * A Christmas "moment": Santa's sleigh flies across the top and tosses candy that tumbles down,
 * bounces and fades. Candy can be tapped to catch it (counted on this device, just for fun).
 * Lives for ~9 seconds, then calls onDone.
 */

const FLIGHT_MS = 7000
const KINDS = ['cane', 'sweet', 'lolly'] as const
type Kind = (typeof KINDS)[number]

interface Candy {
  id: number
  kind: Kind
  x: number
  y: number
  fall: number
  spin: number
  caught: boolean
}

const CANDY_KEY = 'mart-candy'
function caughtSoFar(): number {
  try {
    return Number(localStorage.getItem(CANDY_KEY) ?? 0) || 0
  } catch {
    return 0
  }
}

export default function SantaMoment({ onDone }: { onDone(): void }) {
  const [candies, setCandies] = useState<Candy[]>([])
  const [pop, setPop] = useState<{ x: number; y: number; n: number } | null>(null)
  const start = useRef(performance.now())

  useEffect(() => {
    const timers: number[] = []
    const w = window.innerWidth
    const h = window.innerHeight
    const drops = [1300, 2100, 2900, 3700, 4500, 5300]
    drops.forEach((t, i) => {
      timers.push(
        window.setTimeout(() => {
          // where the sack is at time t (the sleigh crosses from -320px to w + 40px)
          const x = ((t / FLIGHT_MS) * (w + 360) - 320 + 70)
          if (x < 10 || x > w - 30) return
          const y = 70
          setCandies((c) => [
            ...c,
            { id: i, kind: KINDS[i % KINDS.length], x, y, fall: h - y - 70 - (i % 3) * 18, spin: (i % 2 ? 1 : -1) * (360 + i * 90), caught: false },
          ])
        }, t),
      )
    })
    timers.push(window.setTimeout(onDone, FLIGHT_MS + 3200))
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [onDone])

  const catchIt = (c: Candy, e: React.PointerEvent) => {
    if (c.caught) return
    const n = caughtSoFar() + 1
    try {
      localStorage.setItem(CANDY_KEY, String(n))
    } catch {
      /* private mode */
    }
    setCandies((list) => list.map((x) => (x.id === c.id ? { ...x, caught: true } : x)))
    setPop({ x: e.clientX, y: e.clientY, n })
    window.setTimeout(() => setPop(null), 1200)
  }

  return (
    <div className="moment" aria-hidden data-started={start.current}>
      <div className="sleigh" style={{ animationDuration: `${FLIGHT_MS}ms` }}>
        <div className="sleigh-bob">
          <Sleigh />
        </div>
      </div>
      {candies.map((c) => (
        <span
          key={c.id}
          className={`candy${c.caught ? ' caught' : ''}`}
          style={{ left: c.x, top: c.y, ['--fall' as string]: `${c.fall}px`, ['--spin' as string]: `${c.spin}deg` }}
          onPointerDown={(e) => catchIt(c, e)}
        >
          <CandySvg kind={c.kind} />
        </span>
      ))}
      {pop && (
        <span className="candy-pop" style={{ left: pop.x, top: pop.y }}>
          +1 🍬 <small>{pop.n} caught</small>
        </span>
      )}
    </div>
  )
}

function Reindeer({ x, nose }: { x: number; nose?: boolean }) {
  return (
    <g transform={`translate(${x} 34)`}>
      {/* legs (two pairs, galloping) */}
      <g className="leg leg-a">
        <path d="M-12 8 l-4 16 M8 8 l6 15" stroke="#5b3a1e" strokeWidth="3.5" strokeLinecap="round" />
      </g>
      <g className="leg leg-b">
        <path d="M-6 8 l2 16 M14 8 l-1 16" stroke="#6e4726" strokeWidth="3.5" strokeLinecap="round" />
      </g>
      <ellipse cx="0" cy="4" rx="20" ry="10" fill="#8b5a2b" />
      <ellipse cx="2" cy="7" rx="12" ry="5" fill="#c79a6b" opacity="0.6" />
      <path d="M-19 0 q-8 -2 -10 4" stroke="#8b5a2b" strokeWidth="4" fill="none" strokeLinecap="round" />
      {/* neck + head */}
      <path d="M14 -2 L22 -14" stroke="#8b5a2b" strokeWidth="9" strokeLinecap="round" />
      <ellipse cx="27" cy="-17" rx="9" ry="6.5" fill="#8b5a2b" />
      <circle cx="26" cy="-19" r="1.5" fill="#1b1b1b" />
      <path d="M20 -22 l-4 -6" stroke="#6e4726" strokeWidth="3" strokeLinecap="round" />
      {/* antlers */}
      <path d="M22 -22 l-2 -12 l-5 -3 M20 -30 l4 -4 M26 -22 l3 -12 l5 -3 M28 -30 l-3 -5" stroke="#d9b98a" strokeWidth="2" fill="none" strokeLinecap="round" />
      {/* nose */}
      <circle cx="36" cy="-16" r={nose ? 3.6 : 2.4} fill={nose ? '#ff2b2b' : '#3a2414'} className={nose ? 'rudolph' : undefined} />
      {/* harness */}
      <path d="M-2 -6 v20" stroke="#d12f2f" strokeWidth="3" />
      <circle cx="-2" cy="4" r="2.2" fill="#f5c451" />
    </g>
  )
}

function Sleigh() {
  return (
    <svg width="320" height="110" viewBox="0 0 320 110" overflow="visible">
      {/* reins */}
      <path d="M118 42 Q 170 30 212 34 Q 250 30 274 34" stroke="#f5c451" strokeWidth="1.6" fill="none" />
      <Reindeer x={220} />
      <Reindeer x={282} nose />
      {/* sack with presents */}
      <path d="M20 40 q-6 -30 18 -34 q20 -2 18 30 Z" fill="#7a4b26" />
      <rect x="30" y="2" width="12" height="10" rx="1.5" fill="#3ecf8e" />
      <rect x="35" y="2" width="2" height="10" fill="#f5c451" />
      {/* Santa */}
      <circle cx="78" cy="28" r="16" fill="#d12f2f" />
      <rect x="64" y="30" width="28" height="6" fill="#1b1b1b" />
      <rect x="75" y="30" width="6" height="6" fill="#f5c451" />
      <circle cx="82" cy="8" r="9" fill="#f3c9a5" />
      <path d="M73 10 q9 16 18 0 q-2 10 -9 13 q-7 -3 -9 -13 Z" fill="#ffffff" />
      <path d="M73 4 q6 -14 18 -2 l6 -8 l2 5 l-4 6 Z" fill="#d12f2f" />
      <rect x="72" y="2" width="20" height="4" rx="2" fill="#ffffff" />
      <circle cx="99" cy="-4" r="3.2" fill="#ffffff" />
      <circle cx="85" cy="7" r="1.2" fill="#1b1b1b" />
      {/* throwing arm */}
      <g className="santa-arm">
        <path d="M70 24 q-14 -6 -22 -18" stroke="#d12f2f" strokeWidth="7" strokeLinecap="round" fill="none" />
        <circle cx="47" cy="5" r="4" fill="#ffffff" />
      </g>
      {/* sleigh body */}
      <path d="M8 40 L118 40 q14 0 16 -14 l6 -6 l4 4 l-4 4 q-2 28 -28 30 L30 58 q-20 0 -22 -18 Z" fill="#c62828" />
      <path d="M8 40 L118 40" stroke="#f5c451" strokeWidth="3" />
      <path d="M24 50 q30 6 70 0" stroke="#f5c451" strokeWidth="2" fill="none" opacity="0.8" />
      {/* runner */}
      <path d="M2 70 L120 70 q16 0 18 -12" stroke="#f5c451" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M36 58 v12 M96 58 v12" stroke="#f5c451" strokeWidth="3" />
    </svg>
  )
}

function CandySvg({ kind }: { kind: Kind }) {
  if (kind === 'cane') {
    return (
      <svg width="22" height="34" viewBox="0 0 22 34">
        <path d="M6 32 V11 a6 6 0 0 1 12 0" stroke="#ffffff" strokeWidth="6" fill="none" strokeLinecap="round" />
        <path d="M6 32 V11 a6 6 0 0 1 12 0" stroke="#e02424" strokeWidth="6" fill="none" strokeLinecap="round" strokeDasharray="4 4" />
      </svg>
    )
  }
  if (kind === 'sweet') {
    return (
      <svg width="34" height="20" viewBox="0 0 34 20">
        <path d="M2 3 L10 10 L2 17 Z M32 3 L24 10 L32 17 Z" fill="#ffc400" />
        <circle cx="17" cy="10" r="8" fill="#ff3ea5" />
        <path d="M11 7 q6 6 12 0" stroke="#ffffff" strokeWidth="2" fill="none" opacity="0.8" />
      </svg>
    )
  }
  return (
    <svg width="26" height="36" viewBox="0 0 26 36">
      <rect x="12" y="20" width="2.5" height="15" rx="1" fill="#f4e7d0" />
      <circle cx="13" cy="12" r="11" fill="#2ecc71" />
      <path d="M13 12 m-7 0 a7 7 0 1 0 7 -7 a4.5 4.5 0 1 1 -4.5 4.5" stroke="#ffffff" strokeWidth="2.2" fill="none" />
    </svg>
  )
}
