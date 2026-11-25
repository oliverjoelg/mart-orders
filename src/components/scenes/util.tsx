import { useCallback, useEffect, useRef, useState } from 'react'

/** Shared bits for theme scenes and moments. */

/** Same "random" numbers on every render, so things don't jump around. */
export function rand(seed: number) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

/** A fun per-device counter (candy caught, hearts collected…). Returns the new total. */
export function bump(key: string, by = 1): number {
  try {
    const n = (Number(localStorage.getItem(key) ?? 0) || 0) + by
    localStorage.setItem(key, String(n))
    return n
  } catch {
    return by
  }
}

export function readNumber(key: string): number {
  try {
    return Number(localStorage.getItem(key) ?? 0) || 0
  } catch {
    return 0
  }
}

export interface PopItem {
  id: number
  x: number
  y: number
  text: string
  tone?: string
}

/** Little "+1" bubbles where someone tapped. */
export function usePops() {
  const [pops, setPops] = useState<PopItem[]>([])
  const next = useRef(0)
  const add = useCallback((x: number, y: number, text: string, tone?: string) => {
    const id = ++next.current
    setPops((p) => [...p, { id, x, y, text, tone }])
    window.setTimeout(() => setPops((p) => p.filter((q) => q.id !== id)), 1300)
  }, [])
  return { pops, add }
}

export function Pops({ pops }: { pops: PopItem[] }) {
  return (
    <>
      {pops.map((p) => (
        <span key={p.id} className="fx-pop" style={{ left: p.x, top: p.y, background: p.tone }}>
          {p.text}
        </span>
      ))}
    </>
  )
}

/** Calls onDone after ms (once), cleaned up on unmount. */
export function useLifetime(ms: number, onDone: () => void) {
  useEffect(() => {
    const t = window.setTimeout(onDone, ms)
    return () => window.clearTimeout(t)
  }, [ms, onDone])
}

/** Timers that are cleared when the moment ends. */
export function useTimers() {
  const ids = useRef<number[]>([])
  useEffect(() => () => ids.current.forEach((t) => window.clearTimeout(t)), [])
  return useCallback((fn: () => void, ms: number) => {
    ids.current.push(window.setTimeout(fn, ms))
  }, [])
}
