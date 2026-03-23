import { useState } from 'react'
import { signInWithGoogle } from '../lib/auth'

interface LoginViewProps {
  onSignedIn: () => void
}

export function LoginView({ onSignedIn }: LoginViewProps) {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSignIn = async () => {
    setLoading(true)
    setError(null)
    try {
      await signInWithGoogle()
      onSignedIn()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign-in failed'
      if (msg.includes('popup-closed')) {
        setError(null) // user just closed popup
      } else {
        setError(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-view">
      <div className="login-card">
        <div className="login-logo">H</div>
        <h1>Hilbert Talk</h1>
        <p>Claude Code on your VPS, from anywhere.</p>
        <button
          className="login-button"
          onClick={handleSignIn}
          disabled={loading}
        >
          {loading ? 'Signing in...' : 'Sign in with Google'}
        </button>
        {error && <div className="login-error">{error}</div>}
      </div>
    </div>
  )
}
