import { useEffect, useMemo, useState } from 'react'
import { bump, rand, useTimers } from './util'

/**
 * Hacker. Scene: code rain behind the app and CRT scanlines. Moment: the screen glitches, then a
 * terminal pops up and "hacks the mainframe". Tap it to try sudo; it refuses.
 */

const GLYPHS = 'MART0123456789アイウエオカキクケコサシスセソ{}<>/$#'

export function HackerScene() {
  const cols = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => ({
        i,
        l: (i / 22) * 100 + rand(i) * 3,
        d: -rand(i + 40) * 14,
        dur: 8 + rand(i + 80) * 9,
        text: Array.from({ length: 22 }, (_, j) => GLYPHS[Math.floor(rand(i * 37 + j) * GLYPHS.length)]).join('\n'),
      })),
    [],
  )
  return (
    <div className="scene scene-hacker" aria-hidden>
      {cols.map((c) => (
        <span key={c.i} className="hk-col" style={{ left: `${c.l}%`, animationDelay: `${c.d}s`, animationDuration: `${c.dur}s` }}>
          {c.text}
        </span>
      ))}
      <div className="hk-scanlines" />
    </div>
  )
}

const SCRIPT = [
  '> connecting to mart.mainframe…',
  '> bypassing firewall [██████████] 100%',
  '> decrypting t-shirt sizes… XS S M L XL',
  '> ACCESS GRANTED',
  '> downloading 1,000 free t-shirts… jk',
]

export function HackerMoment({ onDone }: { onDone(): void }) {
  const [glitch, setGlitch] = useState(true)
  const [lines, setLines] = useState<string[]>([])
  const [tries, setTries] = useState(0)
  const later = useTimers()

  useEffect(() => {
    later(() => setGlitch(false), 450)
    SCRIPT.forEach((l, i) => later(() => setLines((x) => [...x, l]), 700 + i * 1100))
    later(onDone, 700 + SCRIPT.length * 1100 + 5000)
  }, [later, onDone])

  const sudo = () => {
    const n = bump('mart-sudo')
    setTries((t) => t + 1)
    setLines((x) => [...x, '> sudo free-tshirt', tries === 0 ? 'permission denied. nice try 😏' : `permission denied (${n} attempts logged)`])
  }

  return (
    <div className="moment moment-hacker" aria-hidden>
      {glitch && <div className="hk-glitch" />}
      <div className="hk-term" onPointerDown={sudo} title="Tap to try sudo">
        <div className="hk-term-bar">
          <i />
          <i />
          <i />
          <span>mart@mainframe:~</span>
        </div>
        {lines.map((l, i) => (
          <div key={i} className={l.includes('GRANTED') ? 'hk-ok' : l.startsWith('permission') ? 'hk-no' : undefined}>
            {l}
          </div>
        ))}
        <span className="hk-caret">▋</span>
      </div>
    </div>
  )
}
