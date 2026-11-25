import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { readNumber } from './util'

/**
 * Neon Defender: a small vertical shooter for the Retro Arcade theme (original artwork).
 * Steer with finger / mouse / arrow keys / WASD; the ship fires by itself. Waves of cubes,
 * diamonds that shoot back, and a boss every 5th wave. Power-ups: triple shot, extra life.
 * Canvas + requestAnimationFrame; pauses when the tab is hidden. High score saved per device.
 */

const HI_KEY = 'mart-arcade-hi'
const CYAN = '#21e6ff'
const PINK = '#ff2fb9'
const YELLOW = '#ffe14d'
const VIOLET = '#9d5cff'

type Phase = 'title' | 'play' | 'over'

interface Vec {
  x: number
  y: number
}
interface Enemy extends Vec {
  kind: 'cube' | 'diamond' | 'boss'
  hp: number
  maxHp: number
  r: number
  vx: number
  vy: number
  t: number
  path: 'line' | 'zig' | 'dive' | 'boss'
  baseX: number
  fireIn: number
}
interface Bullet extends Vec {
  vx: number
  vy: number
}
interface Particle extends Vec {
  vx: number
  vy: number
  life: number
  max: number
  c: string
  s: number
}
interface Drop extends Vec {
  kind: 'triple' | 'life'
}

export default function NeonDefender({ onExit }: { onExit(): void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [phase, setPhase] = useState<Phase>('title')
  const [hud, setHud] = useState({ score: 0, lives: 3, wave: 1, hi: readNumber(HI_KEY) })
  const [final, setFinal] = useState({ score: 0, best: false })
  const startRef = useRef<() => void>(() => undefined)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onExit])

  useEffect(() => {
    const cv = canvas.current!
    const ctx = cv.getContext('2d')!
    let W = 0
    let H = 0
    let dpr = 1
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      W = cv.clientWidth
      H = cv.clientHeight
      cv.width = Math.round(W * dpr)
      cv.height = Math.round(H * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    // ---------------------------------------------------------------- state
    const stars = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random(), z: 0.3 + Math.random() * 0.9 }))
    let running = false
    let playing = false
    let last = performance.now()
    const S = {
      player: { x: 0, y: 0 } as Vec,
      target: { x: 0, y: 0 } as Vec,
      lives: 3,
      score: 0,
      wave: 0,
      invuln: 0,
      fireCd: 0,
      triple: 0,
      shake: 0,
      waveTimer: 0,
      bullets: [] as Bullet[],
      enemyBullets: [] as Bullet[],
      enemies: [] as Enemy[],
      particles: [] as Particle[],
      drops: [] as Drop[],
      keys: new Set<string>(),
      banner: 0,
    }

    const pushHud = () => setHud({ score: S.score, lives: S.lives, wave: S.wave, hi: Math.max(readNumber(HI_KEY), S.score) })

    const boom = (x: number, y: number, c: string, n = 18, speed = 3) => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2
        const v = speed * (0.4 + Math.random())
        S.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 30 + Math.random() * 25, c, s: 2 + Math.random() * 2.5 })
      }
    }

    const spawnWave = () => {
      S.wave++
      S.banner = 90
      const n = S.wave
      if (n % 5 === 0) {
        S.enemies.push({ kind: 'boss', hp: 30 + n * 4, maxHp: 30 + n * 4, r: 46, x: W / 2, y: -60, vx: 1.4 + n * 0.05, vy: 1.2, t: 0, path: 'boss', baseX: W / 2, fireIn: 60 })
      } else {
        const count = Math.min(6 + n * 2, 22)
        const pattern = (['line', 'zig', 'dive'] as const)[n % 3]
        for (let i = 0; i < count; i++) {
          const diamond = i % 4 === 3 || (n > 3 && i % 3 === 2)
          const col = i % 8
          const row = Math.floor(i / 8)
          const bx = W * 0.12 + (col / 7) * W * 0.76
          S.enemies.push({
            kind: diamond ? 'diamond' : 'cube',
            hp: diamond ? 2 : 1,
            maxHp: diamond ? 2 : 1,
            r: diamond ? 15 : 13,
            x: bx,
            y: -40 - row * 50 - (pattern === 'dive' ? i * 26 : 0),
            vx: 0,
            vy: 0.8 + n * 0.08 + (pattern === 'dive' ? 0.9 : 0),
            t: i * 0.4,
            path: pattern,
            baseX: bx,
            fireIn: 80 + Math.random() * 140,
          })
        }
      }
      pushHud()
    }

    const reset = () => {
      S.player = { x: W / 2, y: H - 90 }
      S.target = { ...S.player }
      S.lives = 3
      S.score = 0
      S.wave = 0
      S.invuln = 90
      S.triple = 0
      S.bullets = []
      S.enemyBullets = []
      S.enemies = []
      S.particles = []
      S.drops = []
      S.waveTimer = 40
      pushHud()
    }

    const gameOver = () => {
      playing = false
      const prev = readNumber(HI_KEY)
      const best = S.score > prev
      if (best) {
        try {
          localStorage.setItem(HI_KEY, String(S.score))
        } catch {
          /* private mode */
        }
      }
      setFinal({ score: S.score, best })
      setPhase('over')
      pushHud()
    }

    const hitPlayer = () => {
      if (S.invuln > 0) return
      S.lives--
      S.invuln = 110
      S.shake = 14
      boom(S.player.x, S.player.y, CYAN, 30, 4)
      pushHud()
      if (S.lives <= 0) gameOver()
    }

    startRef.current = () => {
      reset()
      playing = true
      setPhase('play')
    }

    // ---------------------------------------------------------------- input
    const toLocal = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const onPointer = (e: PointerEvent) => {
      if (!playing) return
      const p = toLocal(e)
      S.target.x = p.x
      // keep the ship in the lower part; lift it above a finger so the finger doesn't hide it
      S.target.y = Math.max(H * 0.45, Math.min(H - 30, p.y - (e.pointerType === 'touch' ? 70 : 0)))
    }
    cv.addEventListener('pointermove', onPointer)
    cv.addEventListener('pointerdown', onPointer)
    const down = (e: KeyboardEvent) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'd', 'w', 's', 'A', 'D', 'W', 'S'].includes(e.key)) {
        S.keys.add(e.key.toLowerCase())
        e.preventDefault()
      }
    }
    const up = (e: KeyboardEvent) => S.keys.delete(e.key.toLowerCase())
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)

    // ---------------------------------------------------------------- update
    const step = (k: number) => {
      for (const s of stars) {
        s.y += 0.0018 * s.z * k * (playing ? 1.6 : 0.8)
        if (s.y > 1) {
          s.y = 0
          s.x = Math.random()
        }
      }
      for (const p of S.particles) {
        p.x += p.vx * k
        p.y += p.vy * k
        p.vx *= 0.97
        p.vy *= 0.97
        p.life += k
      }
      S.particles = S.particles.filter((p) => p.life < p.max)
      if (!playing) return

      const kx = (S.keys.has('arrowright') || S.keys.has('d') ? 1 : 0) - (S.keys.has('arrowleft') || S.keys.has('a') ? 1 : 0)
      const ky = (S.keys.has('arrowdown') || S.keys.has('s') ? 1 : 0) - (S.keys.has('arrowup') || S.keys.has('w') ? 1 : 0)
      if (kx || ky) {
        S.target.x = S.player.x + kx * 40
        S.target.y = Math.max(H * 0.45, Math.min(H - 30, S.player.y + ky * 40))
      }
      S.player.x += (S.target.x - S.player.x) * Math.min(1, 0.25 * k)
      S.player.y += (S.target.y - S.player.y) * Math.min(1, 0.25 * k)
      S.player.x = Math.max(18, Math.min(W - 18, S.player.x))

      // auto-fire
      S.fireCd -= k
      if (S.fireCd <= 0) {
        S.fireCd = 11
        S.bullets.push({ x: S.player.x, y: S.player.y - 20, vx: 0, vy: -11 })
        if (S.triple > 0) {
          S.bullets.push({ x: S.player.x - 8, y: S.player.y - 14, vx: -2.2, vy: -10.5 })
          S.bullets.push({ x: S.player.x + 8, y: S.player.y - 14, vx: 2.2, vy: -10.5 })
        }
      }
      if (S.triple > 0) S.triple -= k
      if (S.invuln > 0) S.invuln -= k
      if (S.shake > 0) S.shake -= k
      if (S.banner > 0) S.banner -= k

      for (const b of S.bullets) {
        b.x += b.vx * k
        b.y += b.vy * k
      }
      S.bullets = S.bullets.filter((b) => b.y > -20 && b.x > -20 && b.x < W + 20)
      for (const b of S.enemyBullets) {
        b.x += b.vx * k
        b.y += b.vy * k
      }
      S.enemyBullets = S.enemyBullets.filter((b) => b.y < H + 20 && b.x > -20 && b.x < W + 20)

      // enemies
      for (const e of S.enemies) {
        e.t += 0.03 * k
        if (e.path === 'boss') {
          if (e.y < 110) e.y += e.vy * k
          e.x = W / 2 + Math.sin(e.t * 0.8) * (W * 0.32)
        } else if (e.path === 'zig') {
          e.y += e.vy * k
          e.x = e.baseX + Math.sin(e.t * 1.6) * 60
        } else if (e.path === 'dive') {
          e.y += e.vy * k
          e.x = e.baseX + Math.sin(e.t) * 30 + (S.player.x - e.baseX) * Math.min(1, Math.max(0, (e.y - H * 0.25) / H))
        } else {
          e.y += e.vy * k
        }
        e.fireIn -= k
        if (e.fireIn <= 0 && e.y > 0) {
          if (e.kind === 'diamond') {
            const a = Math.atan2(S.player.y - e.y, S.player.x - e.x)
            S.enemyBullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 3.6, vy: Math.sin(a) * 3.6 })
            e.fireIn = 120 + Math.random() * 120
          } else if (e.kind === 'boss') {
            for (let i = -2; i <= 2; i++) S.enemyBullets.push({ x: e.x, y: e.y + 30, vx: i * 1.4, vy: 3.4 })
            e.fireIn = 70
          } else e.fireIn = 9999
        }
        // an enemy that slips past costs a life (the boss never comes down)
        if (e.kind !== 'boss' && e.y > H + 30) {
          e.hp = 0
          hitPlayer()
        }
      }

      // bullets vs enemies
      for (const b of S.bullets) {
        for (const e of S.enemies) {
          if (e.hp <= 0) continue
          if ((b.x - e.x) ** 2 + (b.y - e.y) ** 2 < (e.r + 4) ** 2) {
            const hy = b.y
            e.hp--
            b.y = -999
            boom(b.x, hy, e.kind === 'diamond' ? YELLOW : PINK, 3, 1.5)
            if (e.hp <= 0) {
              const pts = e.kind === 'boss' ? 2000 : e.kind === 'diamond' ? 250 : 100
              S.score += pts
              boom(e.x, e.y, e.kind === 'boss' ? YELLOW : e.kind === 'diamond' ? VIOLET : PINK, e.kind === 'boss' ? 80 : 22, e.kind === 'boss' ? 6 : 3.2)
              if (e.kind === 'boss') S.shake = 22
              if (Math.random() < (e.kind === 'boss' ? 1 : 0.07)) S.drops.push({ x: e.x, y: e.y, kind: Math.random() < 0.35 ? 'life' : 'triple' })
              pushHud()
            }
            break
          }
        }
      }
      S.enemies = S.enemies.filter((e) => e.hp > 0)

      // enemy bullets / bodies vs player
      for (const b of S.enemyBullets) {
        if ((b.x - S.player.x) ** 2 + (b.y - S.player.y) ** 2 < 15 ** 2) {
          b.y = H + 999
          hitPlayer()
        }
      }
      for (const e of S.enemies) {
        if ((e.x - S.player.x) ** 2 + (e.y - S.player.y) ** 2 < (e.r + 12) ** 2) {
          if (e.kind !== 'boss') {
            e.hp = 0
            boom(e.x, e.y, PINK, 18)
          }
          hitPlayer()
        }
      }
      S.enemies = S.enemies.filter((e) => e.hp > 0)

      // power-ups
      for (const d of S.drops) d.y += 1.6 * k
      S.drops = S.drops.filter((d) => {
        if ((d.x - S.player.x) ** 2 + (d.y - S.player.y) ** 2 < 26 ** 2) {
          if (d.kind === 'life') S.lives = Math.min(5, S.lives + 1)
          else S.triple = 600
          boom(d.x, d.y, d.kind === 'life' ? PINK : YELLOW, 14, 2)
          pushHud()
          return false
        }
        return d.y < H + 20
      })

      if (playing && S.enemies.length === 0) {
        S.waveTimer -= k
        if (S.waveTimer <= 0) {
          S.waveTimer = 70
          spawnWave()
        }
      }
    }

    // ---------------------------------------------------------------- draw
    const glow = (c: string, b: number) => {
      ctx.shadowColor = c
      ctx.shadowBlur = b
    }
    const draw = () => {
      ctx.save()
      ctx.clearRect(0, 0, W, H)
      if (S.shake > 0) ctx.translate((Math.random() - 0.5) * S.shake, (Math.random() - 0.5) * S.shake)
      const g = ctx.createLinearGradient(0, 0, 0, H)
      g.addColorStop(0, '#0d0221')
      g.addColorStop(1, '#1d0845')
      ctx.fillStyle = g
      ctx.fillRect(-20, -20, W + 40, H + 40)
      for (const s of stars) {
        ctx.fillStyle = `rgba(255,255,255,${0.3 + s.z * 0.5})`
        ctx.fillRect(s.x * W, s.y * H, s.z * 2, s.z * 2)
      }
      ctx.strokeStyle = 'rgba(33,230,255,0.18)'
      ctx.lineWidth = 1
      for (let i = 0; i < 9; i++) {
        const y = H - 8 - i * i * 5
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(W, y)
        ctx.stroke()
      }

      for (const d of S.drops) {
        glow(d.kind === 'life' ? PINK : YELLOW, 14)
        ctx.fillStyle = d.kind === 'life' ? PINK : YELLOW
        ctx.font = '700 18px Orbitron, monospace'
        ctx.textAlign = 'center'
        ctx.fillText(d.kind === 'life' ? '♥' : '⚡', d.x, d.y + 6)
      }

      for (const e of S.enemies) {
        ctx.save()
        ctx.translate(e.x, e.y)
        if (e.kind === 'cube') {
          ctx.rotate(e.t)
          glow(PINK, 12)
          ctx.strokeStyle = PINK
          ctx.lineWidth = 2.5
          ctx.strokeRect(-e.r, -e.r, e.r * 2, e.r * 2)
          ctx.fillStyle = 'rgba(255,47,185,0.35)'
          ctx.fillRect(-e.r / 2, -e.r / 2, e.r, e.r)
        } else if (e.kind === 'diamond') {
          glow(VIOLET, 14)
          ctx.strokeStyle = e.hp < e.maxHp ? YELLOW : VIOLET
          ctx.lineWidth = 2.5
          ctx.beginPath()
          ctx.moveTo(0, -e.r)
          ctx.lineTo(e.r, 0)
          ctx.lineTo(0, e.r)
          ctx.lineTo(-e.r, 0)
          ctx.closePath()
          ctx.stroke()
          ctx.fillStyle = 'rgba(157,92,255,0.35)'
          ctx.fill()
        } else {
          ctx.rotate(e.t * 0.4)
          glow(YELLOW, 22)
          ctx.strokeStyle = YELLOW
          ctx.lineWidth = 3
          ctx.beginPath()
          for (let i = 0; i < 6; i++) {
            const a = (Math.PI / 3) * i
            ctx.lineTo(Math.cos(a) * e.r, Math.sin(a) * e.r)
          }
          ctx.closePath()
          ctx.stroke()
          ctx.fillStyle = 'rgba(255,47,185,0.35)'
          ctx.fill()
          ctx.rotate(-e.t * 0.8)
          ctx.strokeStyle = PINK
          ctx.strokeRect(-14, -14, 28, 28)
        }
        ctx.restore()
        if (e.kind === 'boss') {
          ctx.shadowBlur = 0
          ctx.fillStyle = 'rgba(255,255,255,0.15)'
          ctx.fillRect(W * 0.2, 56, W * 0.6, 6)
          ctx.fillStyle = YELLOW
          ctx.fillRect(W * 0.2, 56, W * 0.6 * (e.hp / e.maxHp), 6)
        }
      }

      glow(CYAN, 10)
      ctx.fillStyle = CYAN
      for (const b of S.bullets) ctx.fillRect(b.x - 1.5, b.y - 9, 3, 14)
      glow(PINK, 10)
      ctx.fillStyle = '#ff7ad1'
      for (const b of S.enemyBullets) {
        ctx.beginPath()
        ctx.arc(b.x, b.y, 4.5, 0, Math.PI * 2)
        ctx.fill()
      }

      if (playing && !(S.invuln > 0 && Math.floor(S.invuln / 6) % 2 === 0)) {
        const { x, y } = S.player
        glow(CYAN, 16)
        ctx.fillStyle = '#160536'
        ctx.strokeStyle = CYAN
        ctx.lineWidth = 2.5
        ctx.beginPath()
        ctx.moveTo(x, y - 20)
        ctx.lineTo(x + 8, y - 2)
        ctx.lineTo(x + 20, y + 8)
        ctx.lineTo(x + 20, y + 14)
        ctx.lineTo(x + 6, y + 10)
        ctx.lineTo(x, y + 16)
        ctx.lineTo(x - 6, y + 10)
        ctx.lineTo(x - 20, y + 14)
        ctx.lineTo(x - 20, y + 8)
        ctx.lineTo(x - 8, y - 2)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = PINK
        ctx.fillRect(x - 3, y - 6, 6, 8)
        glow(YELLOW, 12)
        ctx.fillStyle = YELLOW
        const f = 6 + Math.random() * 6
        ctx.beginPath()
        ctx.moveTo(x - 4, y + 16)
        ctx.lineTo(x, y + 16 + f)
        ctx.lineTo(x + 4, y + 16)
        ctx.fill()
        if (S.triple > 0) {
          ctx.strokeStyle = 'rgba(255,225,77,0.5)'
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.arc(x, y, 28, 0, Math.PI * 2)
          ctx.stroke()
        }
      }

      ctx.shadowBlur = 0
      ctx.globalCompositeOperation = 'lighter'
      for (const p of S.particles) {
        ctx.globalAlpha = 1 - p.life / p.max
        ctx.fillStyle = p.c
        ctx.fillRect(p.x, p.y, p.s, p.s)
      }
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'

      if (playing && S.banner > 0) {
        glow(PINK, 16)
        ctx.fillStyle = S.wave % 5 === 0 ? YELLOW : PINK
        ctx.globalAlpha = Math.min(1, S.banner / 30)
        ctx.font = '700 26px Orbitron, monospace'
        ctx.textAlign = 'center'
        ctx.fillText(S.wave % 5 === 0 ? `WAVE ${S.wave} · BOSS` : `WAVE ${S.wave}`, W / 2, H * 0.38)
        ctx.globalAlpha = 1
      }
      ctx.restore()
    }

    // ---------------------------------------------------------------- loop
    let raf = 0
    const loop = (now: number) => {
      const k = Math.min(3, (now - last) / 16.67) // frames at 60 fps; capped after a pause
      last = now
      step(k)
      draw()
      raf = requestAnimationFrame(loop)
    }
    const start = () => {
      if (running) return
      running = true
      last = performance.now()
      raf = requestAnimationFrame(loop)
    }
    const stop = () => {
      running = false
      cancelAnimationFrame(raf)
    }
    const onVis = () => (document.hidden ? stop() : start())
    document.addEventListener('visibilitychange', onVis)
    reset()
    start()

    // demo builds only: step the game by hand (for checking it without a visible screen)
    if (import.meta.env.MODE === 'demo' || import.meta.env.DEV) {
      ;(window as unknown as { __nd?: unknown }).__nd = {
        state: S,
        step: (frames: number) => {
          for (let i = 0; i < frames; i++) step(1)
          draw()
          return { score: S.score, wave: S.wave, lives: S.lives, enemies: S.enemies.length, playing }
        },
      }
    }

    return () => {
      stop()
      window.removeEventListener('resize', resize)
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      document.removeEventListener('visibilitychange', onVis)
      cv.removeEventListener('pointermove', onPointer)
      cv.removeEventListener('pointerdown', onPointer)
    }
  }, [])

  return (
    <div className="nd-overlay" role="dialog" aria-modal="true" aria-label="Neon Defender game">
      <canvas ref={canvas} className="nd-canvas" />
      <div className="nd-hud">
        <span>SCORE {String(hud.score).padStart(5, '0')}</span>
        <span>WAVE {Math.max(1, hud.wave)}</span>
        <span className="nd-lives">{'♥'.repeat(Math.max(0, hud.lives))}</span>
        <span>HI {String(Math.max(hud.hi, hud.score)).padStart(5, '0')}</span>
      </div>
      <button className="nd-close" onClick={onExit} aria-label="Close the game" title="Back to MART (Esc)">
        <X size={20} />
      </button>
      {phase === 'title' && (
        <div className="nd-screen">
          <div className="nd-title">NEON DEFENDER</div>
          <p>Drag or move the mouse to steer · arrow keys / WASD work too</p>
          <p>Your ship fires by itself. ⚡ = triple shot, ♥ = extra life.</p>
          <button className="nd-btn" onClick={() => startRef.current()}>
            ▶ START
          </button>
        </div>
      )}
      {phase === 'over' && (
        <div className="nd-screen">
          <div className="nd-title">GAME OVER</div>
          <p className="nd-score">
            {final.score} points{final.best ? ' · NEW HIGH SCORE!' : ''}
          </p>
          <div className="nd-row">
            <button className="nd-btn" onClick={() => startRef.current()}>
              ▶ PLAY AGAIN
            </button>
            <button className="nd-btn nd-btn-ghost" onClick={onExit}>
              Back to MART
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
