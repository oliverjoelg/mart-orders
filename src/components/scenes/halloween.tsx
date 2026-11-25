import { useEffect, useMemo, useState } from 'react'
import { bump, Pops, rand, usePops, useTimers } from './util'

/**
 * Halloween. Scene: a huge moon, a graveyard hill with tombstones and a crooked tree, a flickering
 * jack-o'-lantern, and fog rolling across. Moment: a witch on a broom crosses the moon cackling,
 * then a ghost rises from a grave — tap it to BOO it away.
 */

export function HalloweenScene() {
  const stars = useMemo(() => Array.from({ length: 18 }, (_, i) => ({ i, l: rand(i + 21) * 100, t: rand(i + 3) * 45, s: 1 + rand(i + 8) * 1.6, d: -rand(i + 2) * 4 })), [])
  return (
    <div className="scene scene-halloween" aria-hidden>
      {stars.map((s) => (
        <span key={s.i} className="scene-star" style={{ left: `${s.l}%`, top: `${s.t}%`, width: s.s, height: s.s, animationDelay: `${s.d}s` }} />
      ))}
      <div className="hw-moon" />
      <svg className="scene-ground hw-yard" viewBox="0 0 1440 220" preserveAspectRatio="xMidYMax slice">
        <path d="M0 150 C 260 110, 520 150, 760 130 S 1220 110, 1440 140 L1440 220 L0 220 Z" fill="#1a1024" />
        {/* crooked tree */}
        <path d="M230 140 C 232 100, 220 80, 236 50 M236 70 C 210 60, 196 44, 184 30 M234 58 C 262 48, 274 30, 296 24 M228 92 C 208 88, 196 80, 186 70 M236 50 C 240 36, 236 24, 244 12" stroke="#0e0913" strokeWidth="7" fill="none" strokeLinecap="round" />
        {/* tombstones */}
        {[
          [520, 128, 1],
          [610, 132, 0.8],
          [1030, 120, 1.1],
          [1130, 126, 0.85],
        ].map(([x, y, s], i) => (
          <g key={i} transform={`translate(${x} ${y}) scale(${s})`}>
            <path d="M-18 24 V-6 a18 18 0 0 1 36 0 V24 Z" fill="#3a2d47" />
            <path d="M-8 -2 H8 M0 -10 V8" stroke="#5c4b6e" strokeWidth="3" />
          </g>
        ))}
        {/* jack-o'-lantern */}
        <g transform="translate(860 150)">
          <circle cx="0" cy="-8" r="30" fill="#ff7a1a" opacity="0.25" className="hw-glow" />
          <ellipse cx="0" cy="-6" rx="22" ry="17" fill="#ff7a1a" />
          <path d="M-9 -6 a10 17 0 0 0 0 0 M0 -23 q2 -8 7 -10" stroke="#3d6b2a" strokeWidth="3" fill="none" />
          <path d="M-12 -10 l5 -6 l5 6 Z M2 -10 l5 -6 l5 6 Z M-12 0 q12 10 24 0 l-4 3 l-4 -3 l-4 3 l-4 -3 l-4 3 Z" fill="#ffe08a" className="hw-face" />
        </g>
      </svg>
      <div className="hw-fog hw-fog1" />
      <div className="hw-fog hw-fog2" />
    </div>
  )
}

export function HalloweenMoment({ onDone }: { onDone(): void }) {
  const [ghost, setGhost] = useState<'none' | 'rising' | 'booed'>('none')
  const [ghostX] = useState(() => 20 + Math.random() * 60)
  const later = useTimers()
  const { pops, add } = usePops()

  useEffect(() => {
    later(() => setGhost('rising'), 5200)
    later(onDone, 5200 + 7500)
  }, [later, onDone])

  const boo = (e: React.PointerEvent) => {
    if (ghost !== 'rising') return
    const n = bump('mart-ghosts')
    setGhost('booed')
    add(e.clientX, e.clientY, `BOO! 👻 ${n}`, '#8b5cf6')
  }

  return (
    <div className="moment moment-halloween" aria-hidden>
      <div className="hw-witch">
        <span className="hw-cackle">hehehe!</span>
        <svg width="150" height="90" viewBox="0 0 150 90">
          <path d="M10 60 L120 52" stroke="#3b2414" strokeWidth="5" strokeLinecap="round" />
          <path d="M112 50 l26 -10 l-4 10 l8 4 l-30 6 Z" fill="#a0692e" />
          <path d="M40 56 q10 -26 30 -30 q16 -2 18 14 q-6 14 -22 18 Z" fill="#14081c" />
          <circle cx="76" cy="20" r="9" fill="#7fbf5a" />
          <path d="M60 18 L84 4 L76 22 Z" fill="#14081c" />
          <path d="M56 22 H96" stroke="#14081c" strokeWidth="4" strokeLinecap="round" />
          <path d="M84 21 l7 3" stroke="#14081c" strokeWidth="2" />
          <path d="M64 28 q-14 4 -24 -4" stroke="#14081c" strokeWidth="6" fill="none" strokeLinecap="round" className="hw-cape" />
          <circle cx="79" cy="19" r="1.4" fill="#ffe14d" />
        </svg>
      </div>
      {ghost !== 'none' && (
        <span className={`hw-ghost ${ghost}`} style={{ left: `${ghostX}%` }} onPointerDown={boo}>
          <svg width="70" height="86" viewBox="0 0 70 86">
            <path d="M35 4 C 58 4, 66 22, 66 42 V 78 l-8 -6 l-8 8 l-8 -8 l-7 8 l-7 -8 l-8 8 l-8 -8 l-8 6 V 42 C 4 22, 12 4, 35 4 Z" fill="#f4f0ff" />
            <ellipse cx="25" cy="34" rx="5" ry="7" fill="#1b1224" />
            <ellipse cx="45" cy="34" rx="5" ry="7" fill="#1b1224" />
            <ellipse cx="35" cy="52" rx="6" ry="8" fill="#1b1224" />
          </svg>
        </span>
      )}
      <Pops pops={pops} />
    </div>
  )
}
