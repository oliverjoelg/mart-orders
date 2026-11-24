import { useMemo, type CSSProperties } from 'react'
import type { Decor } from '../lib/themes'

/**
 * The moving bits of a fun theme (snow, sparkles, lights…). A fixed overlay that never takes
 * taps, built from a few dozen CSS-animated elements so cheap phones stay smooth. Hidden when the
 * phone asks for reduced motion (see styles.css) or when switched off in the theme picker.
 */

// same positions on every render (no jumping), different per flake
function rand(seed: number) {
  const x = Math.sin(seed * 9301 + 49297) * 233280
  return x - Math.floor(x)
}

const COUNT: Record<Exclude<Decor, null>, number> = { snow: 36, sparkles: 18, lights: 22, powder: 16, bats: 4, code: 14 }
const GLYPHS = 'MART0123456789アイウエオカキクケコ'

export default function ThemeDecor({ decor }: { decor: Decor }) {
  const bits = useMemo(() => {
    if (!decor) return []
    return Array.from({ length: COUNT[decor] }, (_, i) => ({ i, left: rand(i + 1) * 100, delay: -rand(i + 101) * 20, r3: rand(i + 211) }))
  }, [decor])

  if (!decor) return null

  return (
    <div className={`decor decor-${decor}`} aria-hidden>
      {bits.map(({ i, left, delay, r3 }) => {
        const style: CSSProperties & Record<string, string | number> = { left: `${left}%`, animationDelay: `${delay}s` }
        if (decor === 'snow') {
          style.animationDuration = `${9 + r3 * 10}s`
          style.fontSize = `${8 + r3 * 10}px`
          return (
            <span key={i} style={style}>
              ❄
            </span>
          )
        }
        if (decor === 'sparkles') {
          style.top = `${rand(i + 307) * 100}%`
          style.animationDuration = `${2.5 + r3 * 3}s`
          style.fontSize = `${10 + r3 * 12}px`
          return (
            <span key={i} style={style}>
              {i % 3 ? '✦' : '✧'}
            </span>
          )
        }
        if (decor === 'lights') {
          style.left = `${(i / (COUNT.lights - 1)) * 100}%`
          style.animationDuration = `${1.6 + r3 * 1.6}s`
          style['--bulb'] = ['#ffb020', '#ff5e3a', '#ffe066', '#ff8fc8', '#7cf29a'][i % 5]
          return <span key={i} style={style} />
        }
        if (decor === 'powder') {
          style.animationDuration = `${14 + r3 * 12}s`
          style.width = style.height = `${18 + r3 * 40}px`
          style['--dot'] = ['#ff3ea5', '#ffc400', '#2ecc71', '#3b82f6', '#ff6b00', '#a855f7'][i % 6]
          return <span key={i} style={style} />
        }
        if (decor === 'bats') {
          style.top = `${10 + r3 * 50}%`
          style.animationDuration = `${18 + r3 * 14}s`
          style.animationDelay = `${-i * 7}s`
          return (
            <span key={i} style={style}>
              🦇
            </span>
          )
        }
        // code rain
        style.animationDuration = `${7 + r3 * 8}s`
        return (
          <span key={i} style={style}>
            {Array.from({ length: 14 }, (_, j) => GLYPHS[Math.floor(rand(i * 31 + j) * GLYPHS.length)]).join('\n')}
          </span>
        )
      })}
    </div>
  )
}
