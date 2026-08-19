import { useEffect, useState } from 'react'
import { apiFetch } from './api'

/** The shape `GET /v1/auth/me` returns (src/auth/auth.service.ts, getCurrentUser). */
export interface CurrentUser {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image: string | null
  role: 'USER' | 'ADMIN'
  createdAt: string
}

export interface SessionState {
  user: CurrentUser | null
  loading: boolean
  error: string | null
}

/**
 * The signed-in administrator.
 *
 * This is a display concern, not an access check: the admin gate already refused to serve
 * this bundle to anyone without an ADMIN session, and every endpoint it calls re-checks on
 * the server. Treating the result as authorisation would be the classic mistake — it is only
 * ever a name to put in the header.
 */
export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ user: null, loading: true, error: null })

  useEffect(() => {
    const controller = new AbortController()

    apiFetch<CurrentUser>('/auth/me', { signal: controller.signal })
      .then((user) => setState({ user, loading: false, error: null }))
      .catch((error: unknown) => {
        // React 19 StrictMode mounts effects twice in development; the first pass aborts.
        if (controller.signal.aborted) return
        setState({ user: null, loading: false, error: (error as Error).message })
      })

    return () => controller.abort()
  }, [])

  return state
}

/** Ends the session and returns to the gate, which will render the sign-in page. */
export async function signOut(): Promise<void> {
  await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'same-origin' })
  window.location.assign('/')
}
