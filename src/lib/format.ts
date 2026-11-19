const dateTime = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Kolkata',
})
const dateOnly = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return dateTime.format(new Date(iso))
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return dateOnly.format(new Date(iso))
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—'
  const s = Math.round((now - new Date(iso).getTime()) / 1000)
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  if (s < 7 * 86400) return `${Math.round(s / 86400)} d ago`
  return formatDate(iso)
}

export function inr(n: number): string {
  return `₹${n.toLocaleString('en-IN')}`
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}
