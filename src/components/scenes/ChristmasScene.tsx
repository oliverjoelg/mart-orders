import { useMemo } from 'react'

/**
 * Christmas background (behind the app): night sky with twinkling stars, a soft moon, slow snow,
 * and snowy hills with pine trees and a little cabin with a glowing window along the bottom.
 * Purely decorative: aria-hidden, never takes taps.
 */

function rand(seed: number) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

function Pine({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x="-2" y="0" width="4" height="8" fill="#3b2a1a" />
      <path d="M0 -34 L14 -12 L7 -12 L18 2 L-18 2 L-7 -12 L-14 -12 Z" fill="#14402a" />
      <path d="M0 -34 L6 -25 L-6 -25 Z M-10 -10 L10 -10 L12 -7 L-12 -7 Z" fill="#f2f6f8" opacity="0.85" />
    </g>
  )
}

export default function ChristmasScene() {
  const stars = useMemo(
    () => Array.from({ length: 26 }, (_, i) => ({ i, left: rand(i + 1) * 100, top: rand(i + 50) * 45, size: 1 + rand(i + 90) * 2, delay: -rand(i + 130) * 4 })),
    [],
  )
  const flakes = useMemo(
    () => Array.from({ length: 30 }, (_, i) => ({ i, left: rand(i + 300) * 100, delay: -rand(i + 400) * 30, dur: 18 + rand(i + 500) * 16, size: 4 + rand(i + 600) * 6 })),
    [],
  )

  return (
    <div className="scene scene-christmas" aria-hidden>
      <div className="scene-moon" />
      {stars.map((s) => (
        <span key={`s${s.i}`} className="scene-star" style={{ left: `${s.left}%`, top: `${s.top}%`, width: s.size, height: s.size, animationDelay: `${s.delay}s` }} />
      ))}
      {flakes.map((f) => (
        <span
          key={`f${f.i}`}
          className="scene-flake"
          style={{ left: `${f.left}%`, width: f.size, height: f.size, animationDelay: `${f.delay}s`, animationDuration: `${f.dur}s` }}
        />
      ))}
      <svg className="scene-hills" viewBox="0 0 1440 220" preserveAspectRatio="xMidYMax slice">
        <defs>
          <linearGradient id="xmas-snow-far" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#cfe0ea" />
            <stop offset="1" stopColor="#9fb8c6" />
          </linearGradient>
          <linearGradient id="xmas-snow-near" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f4f8fb" />
            <stop offset="1" stopColor="#c9d9e3" />
          </linearGradient>
          <radialGradient id="xmas-window" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#ffe08a" />
            <stop offset="1" stopColor="#ffb347" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* far hills */}
        <path d="M0 150 C 180 90, 320 120, 480 110 S 820 70, 1000 105 S 1300 95, 1440 120 L1440 220 L0 220 Z" fill="url(#xmas-snow-far)" opacity="0.55" />
        <Pine x={260} y={118} s={0.7} />
        <Pine x={300} y={122} s={0.55} />
        <Pine x={1120} y={104} s={0.65} />
        <Pine x={1160} y={110} s={0.5} />
        {/* cabin */}
        <g transform="translate(900 128)">
          <circle cx="22" cy="18" r="26" fill="url(#xmas-window)" className="scene-window-glow" />
          <rect x="0" y="0" width="46" height="34" fill="#5a3a24" />
          <path d="M-6 2 L23 -22 L52 2 Z" fill="#f4f8fb" />
          <rect x="30" y="-20" width="7" height="14" fill="#5a3a24" />
          <rect x="15" y="10" width="14" height="12" fill="#ffd36b" />
          <path d="M22 10 V22 M15 16 H29" stroke="#5a3a24" strokeWidth="2" />
        </g>
        {/* near hills */}
        <path d="M0 185 C 200 140, 380 175, 620 160 S 1000 130, 1200 165 S 1380 170, 1440 160 L1440 220 L0 220 Z" fill="url(#xmas-snow-near)" />
        <Pine x={120} y={172} s={1.1} />
        <Pine x={170} y={178} s={0.85} />
        <Pine x={1290} y={168} s={1.2} />
        <Pine x={1340} y={175} s={0.9} />
        <Pine x={720} y={158} s={0.75} />
      </svg>
    </div>
  )
}
