import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import type { Api } from './lib/api'
import './styles.css'

try {
  document.documentElement.dataset.theme = localStorage.getItem('mart-theme') ?? 'dark'
} catch {
  document.documentElement.dataset.theme = 'dark'
}

// `npm run dev:demo` runs the app on made-up data with no backend; the demo code is not
// part of the production bundle.
async function createApi(): Promise<Api> {
  if (import.meta.env.MODE === 'demo') return (await import('./lib/api-demo')).createDemoApi()
  return (await import('./lib/api-supabase')).createSupabaseApi()
}

void createApi().then((api) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App api={api} />
    </StrictMode>,
  )
})
