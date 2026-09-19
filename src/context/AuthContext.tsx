import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  ApiError,
  api,
  type ApiUser,
  type LoginPayload,
  type RegisterPayload,
  type UpdateProfilePayload,
} from '@/services/api'

export const TOKEN_STORAGE_KEY = 'pedinburg_token'

interface AuthContextValue {
  user: ApiUser | null
  /** JWT текущей сессии (нужен сервисам для защищённых запросов). */
  token: string | null
  isLoading: boolean
  isAuthenticated: boolean
  isMaster: boolean
  login: (data: LoginPayload) => Promise<ApiUser>
  register: (data: RegisterPayload) => Promise<ApiUser>
  logout: () => void
  updateProfile: (data: UpdateProfilePayload) => Promise<ApiUser>
  deleteAccount: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY)
  } catch {
    // localStorage недоступен (приватный режим, заблокированные cookies)
    return null
  }
}

function persistToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token)
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY)
    }
  } catch {
    // игнорируем: приложение продолжит работать в памяти
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => readStoredToken())
  const [user, setUser] = useState<ApiUser | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(() => readStoredToken() !== null)

  const logout = useCallback(() => {
    persistToken(null)
    setToken(null)
    setUser(null)
    setIsLoading(false)
  }, [])

  // При монтировании приложения подтягиваем профиль по сохранённому токену.
  // isLoading уже выставлен ленивым инициализатором состояния выше.
  useEffect(() => {
    const storedToken = readStoredToken()
    if (!storedToken) {
      return
    }

    let cancelled = false

    api
      .getMe(storedToken)
      .then((response) => {
        if (cancelled) return
        setToken(storedToken)
        setUser(response.user)
      })
      .catch(() => {
        // токен истёк или недействителен — выходим из аккаунта
        if (cancelled) return
        persistToken(null)
        setToken(null)
        setUser(null)
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  const applyAuthResponse = useCallback((nextToken: string, nextUser: ApiUser) => {
    persistToken(nextToken)
    setToken(nextToken)
    setUser(nextUser)
    setIsLoading(false)
    return nextUser
  }, [])

  const login = useCallback(
    async (data: LoginPayload) => {
      const response = await api.login(data)
      return applyAuthResponse(response.token, response.user)
    },
    [applyAuthResponse],
  )

  const register = useCallback(
    async (data: RegisterPayload) => {
      const response = await api.register(data)
      return applyAuthResponse(response.token, response.user)
    },
    [applyAuthResponse],
  )

  const updateProfile = useCallback(
    async (data: UpdateProfilePayload) => {
      if (!token) {
        throw new ApiError(401, 'UNAUTHORIZED', 'Требуется авторизация')
      }
      const response = await api.updateMe(data, token)
      setUser(response.user)
      return response.user
    },
    [token],
  )

  const deleteAccount = useCallback(async () => {
    if (!token) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Требуется авторизация')
    }
    await api.deleteMe(token)
    logout()
  }, [token, logout])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isLoading,
      isAuthenticated: Boolean(user),
      isMaster: user?.role === 'master',
      login,
      register,
      logout,
      updateProfile,
      deleteAccount,
    }),
    [user, token, isLoading, login, register, logout, updateProfile, deleteAccount],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/** Доступ к состоянию авторизации. Использовать только внутри <AuthProvider>. */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth должен использоваться внутри <AuthProvider>')
  }
  return context
}
