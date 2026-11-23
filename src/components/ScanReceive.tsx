import { Camera, Check, ImageUp, Undo2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { friendlyError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { plural } from '../lib/format'
import { decide, groupCandidates, isReadable, langsFor, rank, type Candidate, type Decision, type Ranked } from '../lib/scan/match'
import { frameDiff, getReader, prepareFrame, readText, thumb } from '../lib/scan/ocr'
import { useData } from '../lib/store'
import type { ItemStatus, ItemView, Product } from '../lib/types'

/**
 * Scan mode for Receive: hold each shirt's back up to the camera; the app reads the name, finds
 * it among the names still with the vendor (this colour only), and marks that item as arrived.
 * Unsure reads become big buttons to tap. Everything runs on the phone (free, no server).
 */

interface Done {
  itemId: string
  name: string
  size: string
  prev: Exclude<ItemStatus, 'handed_over'>
}

type Phase = 'loading' | 'ready' | 'reading'

export default function ScanReceive({ product, waiting, onClose }: { product: Product; waiting: ItemView[]; onClose(): void }) {
  const { api } = useAuth()
  const { refreshItems } = useData()
  const videoRef = useRef<HTMLVideoElement>(null)
  const thumbCanvas = useRef<HTMLCanvasElement | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [progress, setProgress] = useState(0)
  const [camera, setCamera] = useState<'starting' | 'on' | 'off'>('starting')
  const [message, setMessage] = useState('Getting the text reader ready…')
  const [choice, setChoice] = useState<Ranked[] | null>(null)
  const [done, setDone] = useState<Done[]>([])
  const [error, setError] = useState<string | null>(null)

  // names still to arrive in this colour (minus what this session already ticked)
  const doneIds = useMemo(() => new Set(done.map((d) => d.itemId)), [done])
  const left = useMemo(() => waiting.filter((i) => !doneIds.has(i.id)), [waiting, doneIds])
  const candidates = useMemo(() => groupCandidates(left), [left])
  const unreadable = left.filter((i) => !isReadable(i.print_name)).length
  const langs = useMemo(() => langsFor(waiting.map((i) => i.print_name)), [waiting])
  const langKey = langs.join('+')

  // what the camera loop reads without restarting
  const live = useRef({
    candidates,
    busy: false,
    paused: false,
    last: null as Uint8ClampedArray | null,
    prev: null as Uint8ClampedArray | null,
    steady: 0,
    lastKey: '',
    lastAt: 0,
  })
  live.current.candidates = candidates
  live.current.paused = !!choice || phase !== 'ready'

  // 1. text reader (downloads the scripts in use once)
  useEffect(() => {
    let alive = true
    setPhase('loading')
    getReader(langKey.split('+'), (f) => alive && setProgress(f))
      .then(() => {
        if (!alive) return
        setPhase('ready')
        setMessage('Hold the back of a shirt inside the box')
      })
      .catch((e) => alive && setError(`Couldn't load the text reader: ${friendlyError(e)}. Check the internet and try again.`))
    return () => {
      alive = false
    }
  }, [langKey])

  // 2. camera
  useEffect(() => {
    let stream: MediaStream | null = null
    let stopped = false
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera('off')
      return
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((s) => {
        if (stopped) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream = s
        const v = videoRef.current
        if (v) {
          v.srcObject = s
          void v.play()
        }
        setCamera('on')
      })
      .catch(() => setCamera('off'))
    return () => {
      stopped = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const mark = useCallback(
    async (c: Candidate, how: 'auto' | 'tap') => {
      const item = left.find((i) => c.itemIds.includes(i.id))
      if (!item || item.status === 'handed_over' || item.status === 'received') return
      try {
        await api.setItemsStatus([item.id], 'received')
        setDone((d) => [{ itemId: item.id, name: c.name, size: c.size, prev: item.status as Done['prev'] }, ...d])
        live.current.lastKey = c.key
        live.current.lastAt = Date.now()
        feedback()
        setMessage(how === 'auto' ? `✓ ${c.name} · ${c.size} marked as arrived` : `✓ ${c.name} · ${c.size}`)
        void refreshItems([item.id])
      } catch (e) {
        setMessage(friendlyError(e))
      }
    },
    [api, left, refreshItems],
  )

  const undo = async (d: Done) => {
    try {
      await api.setItemsStatus([d.itemId], d.prev)
      setDone((list) => list.filter((x) => x.itemId !== d.itemId))
      setMessage(`Undone: ${d.name} · ${d.size} is back on the list`)
      void refreshItems([d.itemId])
    } catch (e) {
      setMessage(friendlyError(e))
    }
  }

  // read one picture: try the cleaned-up black & white version, then the plain grey one
  const process = useCallback(
    async (src: CanvasImageSource, w: number, h: number, crop?: { w: number; h: number }) => {
      if (live.current.busy) return
      live.current.busy = true
      setPhase('reading')
      setMessage('Reading…')
      try {
        let decision: Decision = { kind: 'none' }
        for (const binary of [true, false]) {
          const text = await readText(prepareFrame(src, w, h, { binary, crop }))
          decision = decide(rank(text, live.current.candidates))
          if (decision.kind !== 'none') break
        }
        if (decision.kind === 'match') {
          // the same shirt still in front of the camera: don't tick its twin
          if (decision.best.candidate.key === live.current.lastKey && Date.now() - live.current.lastAt < 4000) {
            setMessage('Same shirt: show the next one')
          } else {
            await mark(decision.best.candidate, 'auto')
          }
        } else if (decision.kind === 'choose') {
          setChoice(decision.options)
          setMessage('Not sure: tap the right name')
        } else {
          setMessage("Couldn't match a name. Hold the back flat and fill the box with the name.")
        }
      } catch (e) {
        setMessage(friendlyError(e))
      } finally {
        live.current.busy = false
        setPhase('ready')
      }
    },
    [mark],
  )

  // 3. auto-capture: when the picture is steady and different from the last one read
  useEffect(() => {
    if (camera !== 'on') return
    thumbCanvas.current ??= document.createElement('canvas')
    const timer = window.setInterval(() => {
      const v = videoRef.current
      const L = live.current
      if (!v || !v.videoWidth || L.busy || L.paused) return
      const t = thumb(v, v.videoWidth, v.videoHeight, thumbCanvas.current!)
      const moving = frameDiff(t, L.prev) > 6
      L.prev = t
      L.steady = moving ? 0 : L.steady + 1
      if (L.steady >= 2 && frameDiff(t, L.last) > 10) {
        L.last = t
        L.steady = 0
        void process(v, v.videoWidth, v.videoHeight)
      }
    }, 300)
    return () => window.clearInterval(timer)
  }, [camera, process])

  const scanNow = () => {
    const v = videoRef.current
    if (v?.videoWidth) {
      live.current.last = null
      void process(v, v.videoWidth, v.videoHeight)
    }
  }

  const fromPhoto = async (file: File) => {
    // createImageBitmap is reliable (img.decode can stall when the page isn't in front) and
    // applies the phone photo's rotation
    let bmp: ImageBitmap | null = null
    try {
      bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
      await process(bmp, bmp.width, bmp.height, { w: 1, h: 1 })
    } catch (e) {
      setMessage(`Couldn't open that photo: ${friendlyError(e)}`)
    } finally {
      bmp?.close()
    }
  }

  return (
    <div className="scan-overlay" role="dialog" aria-modal="true" aria-label={`Scan ${product.name}`}>
      <div className="scan-top">
        <div>
          <b>Scan {product.colour}</b>
          <div className="hint">
            {plural(candidates.length, 'name')} left to find
            {unreadable > 0 && ` · ${unreadable} with no readable name (tick those on the list)`}
          </div>
        </div>
        <button className="btn btn-icon btn-ghost" onClick={onClose} aria-label="Close scanner" title="Back to the list">
          <X size={20} />
        </button>
      </div>

      <div className="scan-stage">
        {camera !== 'off' ? (
          <video ref={videoRef} playsInline muted className="scan-video" />
        ) : (
          <div className="scan-nocam">
            <Camera size={28} />
            <p>The live camera isn't available here (blocked, or opened inside another app).</p>
            <p>
              Use <b>Take a photo</b> below instead, one shirt at a time.
            </p>
          </div>
        )}
        {camera === 'on' && <div className="scan-box" aria-hidden />}
        {phase === 'loading' && !error && (
          <div className="scan-loading">
            Getting the text reader ready{progress > 0 ? ` (${Math.round(progress * 100)}%)` : '…'}
            <div className="hint">First time only: it downloads the reading models for {langs.length > 1 ? `${langs.length} scripts` : 'English'}.</div>
          </div>
        )}
      </div>

      <div className="scan-panel">
        {error ? (
          <div className="callout" style={{ color: 'var(--red)' }}>
            {error}
          </div>
        ) : choice ? (
          <div className="stack-sm">
            <b>Which one is it?</b>
            <div className="scan-choices">
              {choice.map((r) => (
                <button
                  key={r.candidate.key}
                  className="scan-choice"
                  onClick={() => {
                    setChoice(null)
                    void mark(r.candidate, 'tap')
                  }}
                >
                  <span className="scan-choice-name">{r.candidate.name}</span>
                  <span className="hint">Size {r.candidate.size}</span>
                </button>
              ))}
            </div>
            <button
              className="btn"
              onClick={() => {
                setChoice(null)
                setMessage('Skipped. Show the next shirt.')
              }}
            >
              None of these
            </button>
          </div>
        ) : (
          <>
            <div className={`scan-message${message.startsWith('✓') ? ' ok' : ''}`} role="status" aria-live="polite">
              {message}
            </div>
            <div className="row" style={{ gap: 8 }}>
              {camera === 'on' && (
                <button className="btn btn-primary" style={{ flex: 1 }} disabled={phase !== 'ready'} onClick={scanNow}>
                  <Camera size={16} /> Read now
                </button>
              )}
              <button
                className="btn"
                style={{ flex: camera === 'on' ? undefined : 1 }}
                disabled={phase === 'loading'}
                onClick={() => fileRef.current?.click()}
              >
                <ImageUp size={16} /> Take a photo
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                aria-label="Photo of a shirt back"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) void fromPhoto(f)
                }}
              />
            </div>
          </>
        )}

        {done.length > 0 && (
          <div className="scan-done">
            <div className="hint">
              <Check size={12} /> {plural(done.length, 'shirt')} marked as arrived in this scan
            </div>
            {done.slice(0, 4).map((d) => (
              <div key={d.itemId} className="row between scan-done-row">
                <span>
                  <b>{d.name}</b> <span className="hint">· {d.size}</span>
                </span>
                <button className="btn btn-sm btn-ghost" onClick={() => void undo(d)} title="Wrong shirt? Put it back on the list">
                  <Undo2 size={13} /> Undo
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** A short beep and a buzz, so people don't need to look at the screen. */
function feedback() {
  try {
    navigator.vibrate?.(60)
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.frequency.value = 880
    g.gain.value = 0.08
    o.connect(g)
    g.connect(ctx.destination)
    o.start()
    o.stop(ctx.currentTime + 0.12)
    o.onended = () => void ctx.close()
  } catch {
    /* no sound is fine */
  }
}
