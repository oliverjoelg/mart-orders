import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import type { Api } from './lib/api'
import { applyTheme, savedTheme } from './lib/themes'
import './styles.css'

// the saved theme before the first paint, so there is no flash of the default colours
applyTheme(savedTheme(), false)

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
