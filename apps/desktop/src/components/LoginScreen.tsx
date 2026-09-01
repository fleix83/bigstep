import { useState } from 'react'
import type { AuthClient, SessionUser } from '../lib/auth'

interface Props {
  auth: AuthClient
  onSignedIn: (user: SessionUser) => void
  onOpenSettings: () => void
}

/** Anmeldung/Registrierung gegen Neon Auth (Managed Better Auth). */
export function LoginScreen({ auth, onSignedIn, onOpenSettings }: Props) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const result =
        mode === 'signup'
          ? await auth.signUp.email({
              name: name.trim() || email.split('@')[0] || 'Wanderfreund',
              email: email.trim(),
              password,
            })
          : await auth.signIn.email({ email: email.trim(), password })
      if (result.error) {
        setError(result.error.message ?? 'Anmeldung fehlgeschlagen')
        return
      }
      const session = await auth.getSession()
      const user = session.data?.user
      if (user) onSignedIn({ id: user.id, email: user.email, name: user.name })
      else setError('Sitzung konnte nicht geladen werden')
    } catch (e) {
      // Die Beta-SDK wirft bei 4xx (z. B. falsches Passwort) eine Exception
      // statt eines error-Results — deren Message ist aussagekräftiger als
      // ein pauschales «Server nicht erreichbar».
      const raw = e instanceof Error ? e.message : ''
      if (/invalid email or password/i.test(raw)) {
        setError('E-Mail oder Passwort falsch')
      } else if (/already exists/i.test(raw)) {
        setError('Für diese E-Mail existiert schon ein Konto – bitte anmelden')
      } else if (raw && !/failed to fetch|networkerror|load failed/i.test(raw)) {
        setError(raw)
      } else {
        setError('Server nicht erreichbar – stimmt die API-URL?')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-gray-50 p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg">
        <h1 className="mb-1 text-xl font-semibold text-gray-900">Tourenbuch</h1>
        <p className="mb-5 text-sm text-gray-500">
          {mode === 'signin' ? 'Melde dich an.' : 'Konto erstellen.'}
        </p>

        {mode === 'signup' && (
          <>
            <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
            <input
              className="mb-3 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Wie sollen wir dich nennen?"
            />
          </>
        )}

        <label className="mb-1 block text-sm font-medium text-gray-700">E-Mail</label>
        <input
          type="email"
          required
          className="mb-3 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />

        <label className="mb-1 block text-sm font-medium text-gray-700">Passwort</label>
        <input
          type="password"
          required
          minLength={8}
          className="mb-4 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
        />

        {error && (
          <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? 'Einen Moment …' : mode === 'signin' ? 'Anmelden' : 'Registrieren'}
        </button>

        <div className="mt-4 flex items-center justify-between text-sm">
          <button
            type="button"
            className="text-blue-700 hover:underline"
            onClick={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin')
              setError(null)
            }}
          >
            {mode === 'signin' ? 'Neues Konto erstellen' : 'Ich habe schon ein Konto'}
          </button>
          <button
            type="button"
            className="text-gray-400 hover:text-gray-600"
            title="API-URL ändern"
            onClick={onOpenSettings}
          >
            ⚙︎
          </button>
        </div>
      </form>
    </div>
  )
}
