import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, UNAUTHORIZED_EVENT } from './api'
import { AuthContext } from './auth'

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    api<{ user: string }>('/auth/session')
      .then((session) => setUser(session.user))
      .catch(() => setUser(null))
      .finally(() => setChecking(false))

    const signedOut = () => setUser(null)
    window.addEventListener(UNAUTHORIZED_EVENT, signedOut)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, signedOut)
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const session = await api<{ user: string }>('/auth/login', { method: 'POST', body: { username, password } })
    setUser(session.user)
  }, [])

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST', body: {} }).catch(() => undefined)
    setUser(null)
  }, [])

  const value = useMemo(() => ({ user, checking, login, logout }), [user, checking, login, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export default AuthProvider
