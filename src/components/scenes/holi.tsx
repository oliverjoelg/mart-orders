import { useEffect, useMemo, useState } from 'react'
import { bump, Pops, rand, usePops, useTimers } from './util'

/**
 * Holi. Scene: drifting colour clouds and plates heaped with gulal along the bottom.
 * Moment: water balloons float up — tap one and it bursts into a big colour splash; the ones
 * you miss pop at the top.
 */

const COLOURS = ['#ff3ea5', '#ffc400', '#2ecc71', '#3b82f6', '#ff6b00', '#a855f7']

function Splat({ colour, size }: { colour: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <path
        d="M50 12 C 58 26, 70 10, 74 24 C 78 36, 94 30, 88 46 C 84 56, 98 64, 84 72 C 72 78, 76 94, 60 88 C 50 84, 44 98, 36 86 C 28 76, 10 86, 14 70 C 16 60, 2 54, 14 44 C 24 38, 12 22, 28 22 C 38 22, 40 6, 50 12 Z"
        fill={colour}
      />
      <circle cx="12" cy="18" r="5" fill={colour} />
      <circle cx="92" cy="86" r="4" fill={colour} />
      <circle cx="90" cy="14" r="3" fill={colour} />
    </svg>
  )
}

export function HoliScene() {
  const clouds = useMemo(() => Array.from({ length: 6 }, (_, i) => ({ i, l: rand(i + 2) * 90, t: 10 + rand(i + 20) * 60, s: 220 + rand(i + 40) * 220, d: -rand(i + 60) * 30, c: COLOURS[i % COLOURS.length] })), [])
  return (
    <div className="scene scene-holi" aria-hidden>
      {clouds.map((c) => (
        <span key={c.i} className="hl-cloud" style={{ left: `${c.l}%`, top: `${c.t}%`, width: c.s, height: c.s, animationDelay: `${c.d}s`, ['--c' as string]: c.c }} />
      ))}
      <svg className="scene-ground hl-plates" viewBox="0 0 1440 160" preserveAspectRatio="xMidYMax slice">
        {[120, 300, 1120, 1300].map((x, i) => (
          <g key={x} transform={`translate(${x} 120)`}>
            <ellipse cx="0" cy="22" rx="70" ry="12" fill="#d9b98a" />
            <ellipse cx="0" cy="18" rx="62" ry="9" fill="#f1dcb8" />
            <path d="M-50 18 Q 0 -40 50 18 Z" fill={COLOURS[i % COLOURS.length]} />
            <path d="M-50 18 Q -20 0 0 -12" stroke="#ffffff" strokeWidth="3" opacity="0.35" fill="none" />
          </g>
        ))}
      </svg>
    </div>
  )
}

interface Balloon {
  id: number
  x: number
  colour: string
  dur: number
  popped: boolean
  px?: number
  py?: number
}

export function HoliMoment({ onDone }: { onDone(): void }) {
  const [balloons, setBalloons] = useState<Balloon[]>([])
  const [splats, setSplats] = useState<{ id: number; x: number; y: number; colour: string; size: number }[]>([])
  const later = useTimers()
  const { pops, add } = usePops()

  useEffect(() => {
    for (let i = 0; i < 8; i++) {
      later(() => {
        const dur = 5 + rand(i + 9) * 2.5
        const b: Balloon = { id: i, x: 6 + rand(i * 7 + 3) * 86, colour: COLOURS[i % COLOURS.length], dur, popped: false }
        setBalloons((list) => [...list, b])
        // missed: pops by itself near the top
        later(() => {
          setBalloons((list) => {
            const cur = list.find((q) => q.id === i)
            if (!cur || cur.popped) return list
            setSplats((s) => [...s, { id: 100 + i, x: (cur.x / 100) * window.innerWidth, y: 70, colour: cur.colour, size: 70 }])
            return list.map((q) => (q.id === i ? { ...q, popped: true } : q))
          })
        }, dur * 1000 - 200)
      }, 300 + i * 700)
    }
    later(onDone, 300 + 8 * 700 + 8000)
  }, [later, onDone])

  const burst = (b: Balloon, e: React.PointerEvent) => {
    if (b.popped) return
    const n = bump('mart-balloons')
    setBalloons((list) => list.map((q) => (q.id === b.id ? { ...q, popped: true } : q)))
    setSplats((s) => [...s, { id: 200 + b.id, x: e.clientX, y: e.clientY, colour: b.colour, size: 150 }])
    add(e.clientX, e.clientY, `Holi hai! 🎈 ${n}`, b.colour)
  }

  return (
    <div className="moment moment-holi" aria-hidden>
      {balloons.map((b) =>
        b.popped ? null : (
          <span key={b.id} className="hl-balloon" style={{ left: `${b.x}%`, animationDuration: `${b.dur}s` }} onPointerDown={(e) => burst(b, e)}>
            <svg width="44" height="62" viewBox="0 0 44 62">
              <path d="M22 2 C 36 2, 42 14, 42 24 C 42 38, 30 48, 22 50 C 14 48, 2 38, 2 24 C 2 14, 8 2, 22 2 Z" fill={b.colour} />
              <path d="M12 14 q4 -6 10 -7" stroke="#ffffff" strokeWidth="3" opacity="0.6" fill="none" strokeLinecap="round" />
              <path d="M19 50 l3 4 l3 -4 Z" fill={b.colour} />
              <path d="M22 54 q-4 4 0 8" stroke="#9a8a7a" strokeWidth="1.2" fill="none" />
            </svg>
          </span>
        ),
      )}
      {splats.map((s) => (
        <span key={s.id} className="hl-splat" style={{ left: s.x - s.size / 2, top: s.y - s.size / 2 }}>
          <Splat colour={s.colour} size={s.size} />
        </span>
      ))}
      <Pops pops={pops} />
    </div>
  )
}
