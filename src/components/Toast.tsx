import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

interface ToastItem {
  id: number
  kind: 'ok' | 'err'
  text: string
}

interface ToastApi {
  ok(text: string): void
  err(text: string): void
}

const Ctx = createContext<ToastApi | null>(null)
let seq = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const push = useCallback((kind: ToastItem['kind'], text: string) => {
    const id = ++seq
    setItems((list) => [...list.slice(-3), { id, kind, text }])
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), kind === 'err' ? 6000 : 3200)
  }, [])

  const [api] = useState<ToastApi>(() => ({ ok: (t) => push('ok', t), err: (t) => push('err', t) }))

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'err' ? 'alert' : 'status'}>
            {t.kind === 'ok' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useToast(): ToastApi {
  const v = useContext(Ctx)
  if (!v) throw new Error('useToast outside ToastProvider')
  return v
}
