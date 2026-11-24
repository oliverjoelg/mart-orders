/**
 * Fun themes. Each one is a set of colours in styles.css (`:root[data-theme='…']`), an optional
 * heading font (loaded only when the theme is picked) and an optional moving decoration.
 * Status colours (ready, problem, …) stay the same in every theme so nothing gets confusing.
 * The choice is saved on this device only.
 */

export type Decor = 'snow' | 'sparkles' | 'lights' | 'powder' | 'bats' | 'code' | null

export interface ThemeDef {
  id: string
  name: string
  emoji: string
  blurb: string
  mode: 'dark' | 'light'
  /** preview colours for the picker: background, surface, accent, second accent */
  swatch: [string, string, string, string]
  decor: Decor
  /** Google Fonts family for headings, e.g. 'Pacifico' */
  font?: string
}

export const THEMES: ThemeDef[] = [
  { id: 'dark', name: 'MART Dark', emoji: '🌑', blurb: 'The classic', mode: 'dark', swatch: ['#0f0f0f', '#1b1b1b', '#3ecf8e', '#262626'], decor: null },
  { id: 'light', name: 'MART Light', emoji: '☀️', blurb: 'Clean and bright', mode: 'light', swatch: ['#fbfbfb', '#ffffff', '#1fa36a', '#e6e6e6'], decor: null },
  { id: 'christmas', name: 'Christmas', emoji: '🎄', blurb: 'Pine, candy-cane red and falling snow', mode: 'dark', swatch: ['#0d2016', '#183222', '#d12f2f', '#f5c451'], decor: 'snow', font: 'Mountains of Christmas' },
  { id: 'barbie', name: 'Barbie', emoji: '💖', blurb: 'Hot pink everything, with sparkles', mode: 'light', swatch: ['#ffeef6', '#ffffff', '#d0147a', '#ff8fc8'], decor: 'sparkles', font: 'Pacifico' },
  { id: 'diwali', name: 'Diwali', emoji: '🪔', blurb: 'Marigold gold and twinkling lights', mode: 'dark', swatch: ['#160c2e', '#261a4d', '#ffb020', '#ff5e3a'], decor: 'lights', font: 'Yatra One' },
  { id: 'holi', name: 'Holi', emoji: '🌈', blurb: 'Colour powder everywhere', mode: 'light', swatch: ['#fffaf3', '#ffffff', '#c41d8f', '#ffc400'], decor: 'powder', font: 'Baloo 2' },
  { id: 'halloween', name: 'Halloween', emoji: '🎃', blurb: 'Pumpkin orange and a few bats', mode: 'dark', swatch: ['#120c18', '#22172d', '#ff7a1a', '#8b5cf6'], decor: 'bats', font: 'Creepster' },
  { id: 'arcade', name: 'Retro Arcade', emoji: '🕹️', blurb: 'Synthwave neon and a glowing grid', mode: 'dark', swatch: ['#0d0221', '#1d0845', '#ff2fb9', '#21e6ff'], decor: null, font: 'Orbitron' },
  { id: 'hacker', name: 'Hacker', emoji: '💻', blurb: 'Green terminal with falling code', mode: 'dark', swatch: ['#000a00', '#051a05', '#33ff66', '#0d3b0d'], decor: 'code' },
]

export const DEFAULT_THEME = 'dark'
const KEY = 'mart-theme'
const DECOR_KEY = 'mart-decor'

export function themeById(id: string | null | undefined): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

export function savedTheme(): ThemeDef {
  try {
    return themeById(localStorage.getItem(KEY))
  } catch {
    return themeById(DEFAULT_THEME)
  }
}

export function decorOn(): boolean {
  try {
    return localStorage.getItem(DECOR_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setDecorOn(on: boolean) {
  try {
    localStorage.setItem(DECOR_KEY, on ? 'on' : 'off')
  } catch {
    /* private mode */
  }
}

const loadedFonts = new Set<string>()

/** Switch the page to a theme: colours, light/dark mode, phone status-bar colour, heading font. */
export function applyTheme(t: ThemeDef, save = true) {
  const root = document.documentElement
  root.dataset.theme = t.id
  root.dataset.mode = t.mode
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.swatch[0])
  if (t.font && !loadedFonts.has(t.font)) {
    loadedFonts.add(t.font)
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(t.font).replace(/%20/g, '+')}&display=swap`
    document.head.appendChild(link)
  }
  if (save) {
    try {
      localStorage.setItem(KEY, t.id)
    } catch {
      /* private mode */
    }
  }
}
