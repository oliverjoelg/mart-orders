import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
// Publishable (anon) key: public by design; row-level security protects the data.
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!url || !key) {
    throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are not set (see .env.example)')
  }
  if (key.startsWith('sb_secret_')) {
    throw new Error('A secret Supabase key must never be used in the browser')
  }
  client ??= createClient(url, key, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  })
  return client
}
