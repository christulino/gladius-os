import { useState } from 'react'
import { auth } from '@/lib/api'

export default function Setup({ onSetup }) {
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail]             = useState('')
  const [password, setPassword]       = useState('')
  const [confirm, setConfirm]         = useState('')
  const [error, setError]             = useState(null)
  const [loading, setLoading]         = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)
    try {
      const { user } = await auth.setup({
        email,
        password,
        display_name: displayName,
      })
      onSetup(user)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm">
        <div className="bg-card border border-border rounded-lg p-6 shadow-sm">
          <div className="text-center mb-6">
            <h1 className="text-sm font-semibold text-foreground">Gladius</h1>
            <p className="text-xs text-muted-foreground mt-1">Create your admin account to get started</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Your name</label>
              <input
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                required
                autoFocus
                className="w-full px-3 py-2 text-xs bg-background border border-border rounded
                           text-foreground placeholder:text-muted-foreground/60
                           focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                placeholder="Chris Tulino"
              />
            </div>

            <div>
              <label className="block text-xs text-muted-foreground mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="w-full px-3 py-2 text-xs bg-background border border-border rounded
                           text-foreground placeholder:text-muted-foreground/60
                           focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="block text-xs text-muted-foreground mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="w-full px-3 py-2 text-xs bg-background border border-border rounded
                           text-foreground placeholder:text-muted-foreground/60
                           focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                placeholder="Minimum 8 characters"
              />
            </div>

            <div>
              <label className="block text-xs text-muted-foreground mb-1">Confirm password</label>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                className="w-full px-3 py-2 text-xs bg-background border border-border rounded
                           text-foreground placeholder:text-muted-foreground/60
                           focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                placeholder="Repeat password"
              />
            </div>

            {error && (
              <p className="text-xs text-destructive">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 text-xs font-medium rounded
                         bg-primary text-white hover:bg-primary/90
                         disabled:opacity-50 disabled:cursor-not-allowed
                         transition-colors"
            >
              {loading ? 'Creating account...' : 'Create admin account'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
