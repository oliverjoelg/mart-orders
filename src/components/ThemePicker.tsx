import { Check } from 'lucide-react'
import { THEMES, type ThemeDef } from '../lib/themes'
import { Modal, Switch } from './ui'

/** Pick a theme: a grid of little previews. Saved on this device only. */
export default function ThemePicker({
  current,
  decor,
  onPick,
  onDecor,
  onClose,
}: {
  current: ThemeDef
  decor: boolean
  onPick(t: ThemeDef): void
  onDecor(on: boolean): void
  onClose(): void
}) {
  return (
    <Modal title="Pick a theme" onClose={onClose}>
      <div className="theme-grid">
        {THEMES.map((t) => {
          const [bg, surface, accent, accent2] = t.swatch
          const on = t.id === current.id
          return (
            <button
              key={t.id}
              type="button"
              className={`theme-card${on ? ' on' : ''}`}
              onClick={() => onPick(t)}
              aria-pressed={on}
              title={t.blurb}
            >
              <span className="theme-preview" style={{ background: bg }} aria-hidden>
                <span className="theme-preview-side" style={{ background: surface }} />
                <span className="theme-preview-body">
                  <span style={{ background: surface }} />
                  <span style={{ background: surface }} />
                  <span className="theme-preview-btn" style={{ background: accent }} />
                  <span className="theme-preview-dot" style={{ background: accent2 }} />
                </span>
                <span className="theme-preview-emoji">{t.emoji}</span>
              </span>
              <span className="theme-card-name">
                {t.name}
                {on && <Check size={14} />}
              </span>
              <span className="hint">{t.blurb}</span>
            </button>
          )
        })}
      </div>
      {current.id === 'arcade' && (
        <button
          type="button"
          className="btn btn-primary"
          style={{ marginTop: 14, width: '100%' }}
          onClick={() => {
            onClose()
            window.dispatchEvent(new Event('mart:play-arcade'))
          }}
        >
          🕹️ Play Neon Defender
        </button>
      )}
      <div style={{ marginTop: 14 }}>
        <Switch checked={decor} onChange={onDecor} label="Moving decorations (snow, sparkles, bats…)" />
      </div>
      <p className="hint" style={{ marginBottom: 0 }}>Saved on this device only. Statuses keep their usual colours in every theme.</p>
    </Modal>
  )
}
