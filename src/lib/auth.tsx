import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Api, AuthUser } from './api'
import { friendlyError } from './api'
import type { Member } from './types'

export type AuthStatus = 'loading' | 'signed_out' | 'not_member' | 'ready' | 'error'

interface AuthState {
  api: Api
  status: AuthStatus
  user: AuthUser | null
  member: Member | null
  error: string | null
  signIn(): Promise<void>
  signOut(): Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

/** Error Supabase puts in the redirect URL when our sign-up trigger refuses an email. */
function readRedirectError(): string | null {
  const params = new URLSearchParams(window.location.search || window.location.hash.replace(/^#\/?/, ''))
  const desc = params.get('error_description')
  if (!desc) return null
  window.history.replaceState(null, '', window.location.pathname + '#/')
  if (/database error|team list/i.test(desc)) {
    return 'That Google account is not on the MART team list. Ask a main admin or IT to add your @mdi.ac.in email.'
  }
  return desc
}

export function AuthProvider({ api, children }: { api: Api; children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [member, setMember] = useState<Member | null>(null)
  const [error, setError] = useState<string | null>(() => readRedirectError())

  const refresh = useCallback(async () => {
    try {
      const u = await api.getUser()
      setUser(u)
      if (!u) {
        setMember(null)
        setStatus('signed_out')
        return
      }
      const m = await api.getMyMember(u)
      setMember(m)
      setStatus(m ? 'ready' : 'not_member')
    } catch (e) {
      setError(friendlyError(e))
      setStatus('error')
    }
  }, [api])

  useEffect(() => {
    void refresh()
    return api.onAuthChange(() => void refresh())
  }, [api, refresh])

  const value = useMemo<AuthState>(
    () => ({
      api,
      status,
      user,
      member,
      error,
      async signIn() {
        setError(null)
        try {
          await api.signIn()
        } catch (e) {
          setError(friendlyError(e))
        }
      },
      async signOut() {
        await api.signOut()
        await refresh()
      },
    }),
    [api, status, user, member, error, refresh],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}
