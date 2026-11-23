/**
 * The text reader for scan mode: Tesseract.js (free, open source) running in the browser, so
 * nothing leaves the phone. It downloads the reading models for the scripts in use once (they
 * are cached by the browser), then reads each camera frame locally.
 */
import type { Worker } from 'tesseract.js'

let worker: Worker | null = null
let workerLangs = ''
let starting: Promise<Worker> | null = null

/** A reader for these languages; reuses the last one if the languages are the same. */
export async function getReader(langs: string[], onProgress?: (fraction: number) => void): Promise<Worker> {
  const key = [...langs].sort().join('+')
  if (worker && workerLangs === key) return worker
  if (starting && workerLangs === key) return starting
  if (worker) {
    void worker.terminate()
    worker = null
  }
  workerLangs = key
  starting = (async () => {
    const { createWorker, OEM, PSM } = await import('tesseract.js')
    const w = await createWorker(langs, OEM.LSTM_ONLY, {
      logger: (m: { status: string; progress: number }) => {
        if (/loading|initiali/i.test(m.status)) onProgress?.(m.progress)
      },
    })
    // names sit anywhere on the back, with logos around them
    await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT })
    worker = w
    starting = null
    return w
  })()
  return starting
}

export async function readText(img: HTMLCanvasElement): Promise<string> {
  if (!worker) throw new Error('Text reader not ready')
  const { data } = await worker.recognize(img)
  return data.text ?? ''
}

/**
 * Crop the middle of the frame (where the guide box is), scale it to a size Tesseract likes,
 * and make it dark text on a light background: light-on-dark shirts (white print on navy) are
 * inverted. `binary` also snaps every pixel to black or white (Otsu), which helps bold prints.
 */
export function prepareFrame(
  src: CanvasImageSource,
  srcW: number,
  srcH: number,
  { binary = true, crop = { w: 0.9, h: 0.6 } }: { binary?: boolean; crop?: { w: number; h: number } } = {},
): HTMLCanvasElement {
  const cw = Math.round(srcW * crop.w)
  const ch = Math.round(srcH * crop.h)
  const sx = Math.round((srcW - cw) / 2)
  const sy = Math.round((srcH - ch) / 2)
  const scale = Math.min(1, 1400 / cw)
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(cw * scale))
  out.height = Math.max(1, Math.round(ch * scale))
  const ctx = out.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(src, sx, sy, cw, ch, 0, 0, out.width, out.height)
  const img = ctx.getImageData(0, 0, out.width, out.height)
  const d = img.data
  const hist = new Array<number>(256).fill(0)
  let sum = 0
  for (let i = 0; i < d.length; i += 4) {
    const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])
    d[i] = d[i + 1] = d[i + 2] = g
    hist[g]++
    sum += g
  }
  const n = d.length / 4
  const dark = sum / n < 110 // mostly dark picture: a dark shirt with light print
  const t = binary ? otsu(hist, n) : 0
  for (let i = 0; i < d.length; i += 4) {
    let g = d[i]
    if (dark) g = 255 - g
    if (binary) g = (dark ? 255 - d[i] : d[i]) > (dark ? 255 - t : t) ? 255 : 0
    d[i] = d[i + 1] = d[i + 2] = g
  }
  ctx.putImageData(img, 0, 0)
  return out
}

function otsu(hist: number[], total: number): number {
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let sumB = 0
  let wB = 0
  let best = 0
  let threshold = 127
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) ** 2
    if (between > best) {
      best = between
      threshold = t
    }
  }
  return threshold
}

/** Tiny grey thumbnail for "has the picture changed / is it steady?" checks. */
export function thumb(src: CanvasImageSource, srcW: number, srcH: number, canvas: HTMLCanvasElement): Uint8ClampedArray {
  canvas.width = 48
  canvas.height = 36
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(src, 0, 0, srcW, srcH, 0, 0, 48, 36)
  return ctx.getImageData(0, 0, 48, 36).data
}

/** Average per-pixel difference (0–255) between two thumbnails. */
export function frameDiff(a: Uint8ClampedArray | null, b: Uint8ClampedArray | null): number {
  if (!a || !b || a.length !== b.length) return 255
  let s = 0
  for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
  return s / (a.length / 4) / 3
}
