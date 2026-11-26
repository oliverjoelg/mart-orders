/**
 * After a deploy, a tab that was already open still runs the old build. Its lazily loaded
 * files (the game, the Excel reader, OCR) have new names on the server, so loading one fails
 * with a 404. When that happens we reload once to pick up the new build. If a reload already
 * happened in the last 30 s the failure is something else (offline, server down), so we stop
 * instead of looping.
 */
const KEY = 'mart:fresh-build-reload'
const WINDOW_MS = 30_000

export function reloadForNewBuild(
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined,
  now: number,
  reload: () => void,
): boolean {
  try {
    const last = Number(storage?.getItem(KEY) ?? 0)
    if (now - last < WINDOW_MS) return false
    storage?.setItem(KEY, String(now))
  } catch {
    // storage blocked: still reload once; worst case the browser shows the error page
  }
  reload()
  return true
}

/** Vite fires `vite:preloadError` when a lazily loaded file can't be fetched. */
export function watchForNewBuild(): void {
  window.addEventListener('vite:preloadError', () => {
    let storage: Storage | undefined
    try {
      storage = window.sessionStorage
    } catch {
      storage = undefined
    }
    reloadForNewBuild(storage, Date.now(), () => window.location.reload())
  })
}
