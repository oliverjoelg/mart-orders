import { ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { copyText } from '../lib/csv'

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

/**
 * Google refuses sign-in inside apps' built-in browsers (WhatsApp, Instagram, LinkedIn...).
 * Source: https://developers.googleblog.com/2016/08/modernizing-oauth-interactions-in-native-apps.html
 */
function inAppBrowser(): boolean {
  return /; wv\)|FBAN|FBAV|Instagram|WhatsApp|LinkedInApp|Snapchat|Line\/|GSA\//i.test(navigator.userAgent)
}

export default function Login() {
  const { signIn, error, api } = useAuth()
  const [copied, setCopied] = useState(false)
  const embedded = api.mode !== 'demo' && inAppBrowser()
  return (
    <div className="login">
      <div className="card login-card">
        <span className="brand-mark">
          <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
            <path d="M7 24V8l9 9 9-9v16" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <div className="stack-sm">
          <h1>MART Orders</h1>
          <p>Stock and handovers for the MDI Gurgaon campus store.</p>
        </div>
        {error && <div className="callout err" style={{ textAlign: 'left' }}>{error}</div>}
        {embedded && (
          <div className="callout warn" style={{ textAlign: 'left', flexDirection: 'column' }}>
            <b>Open this page in Chrome to sign in.</b>
            <span>Google blocks sign-in inside WhatsApp, Instagram and similar apps. Tap ⋮ → “Open in Chrome”, or copy the link.</span>
            <button
              className="btn btn-sm"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => void copyText(window.location.href.split('#')[0]).then(() => setCopied(true))}
            >
              {copied ? 'Link copied' : 'Copy link'}
            </button>
          </div>
        )}
        <button className="btn btn-lg btn-block google-btn" onClick={() => void signIn()}>
          <GoogleG />
          {api.mode === 'demo' ? 'Enter demo' : 'Sign in with Google'}
        </button>
        <div className="row hint" style={{ justifyContent: 'center' }}>
          <ShieldCheck size={14} />
          MART team only · @mdi.ac.in accounts on the team list
        </div>
      </div>
    </div>
  )
}
