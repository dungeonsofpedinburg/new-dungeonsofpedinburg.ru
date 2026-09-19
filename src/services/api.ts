/**
 * Клиент API «Подземелий Пединбурга».
 *
 * Бэкенд — Yandex Cloud Functions, вызывается напрямую по URL функции.
 * Прямой вызов не пропускает подпути (`/<id>/ping` → ProxyIntegrationError),
 * поэтому маршрут передаётся query-параметром `?route=/ping`, который
 * разбирается в `backend/index.js` (resolvePath).
 */

export const API_BASE_URL = 'https://functions.yandexcloud.net/d4ejgqppc85no82ns36m'

/**
 * Заголовок для JWT. `Authorization` использовать нельзя: при прямом вызове функции
 * платформа Yandex Cloud отвечает `403 Forbidden: Not authorized` (заголовок зарезервирован
 * под IAM-токен), поэтому клиент и бэкенд используют `X-Auth-Token`.
 */
export const AUTH_TOKEN_HEADER = 'X-Auth-Token'

const ROUTE_QUERY_PARAM = 'route'

export type UserRole = 'player' | 'master'
export type UserGender = 'male' | 'female' | 'other'

export interface ApiUser {
  id: string
  email: string
  name: string
  role: UserRole
  gender: UserGender | null
  birth_date: string | null
  telegram_username: string | null
  avatar_url: string | null
  created_at: string | null
  updated_at: string | null
}

export interface AuthResponse {
  token: string
  user: ApiUser
}

export interface RegisterPayload {
  name: string
  email: string
  password: string
  telegram_username?: string | null
  master_code?: string | null
  gender?: UserGender | null
  birth_date?: string | null
}

export interface LoginPayload {
  email: string
  password: string
}

export interface UpdateProfilePayload {
  name?: string
  gender?: UserGender | null
  birth_date?: string | null
  telegram_username?: string | null
  avatar_url?: string | null
}

export type AdventureStatus = 'draft' | 'synced' | 'active'

export interface Adventure {
  id: string
  master_id: string
  master_name: string
  title: string
  description: string | null
  system: string | null
  is_online: boolean | string | null
  player_level: string | null
  game_date: string | null
  game_time: string | null
  /** Числовые поля могут прийти и числом, и строкой — форматтеры приводят тип сами. */
  duration_hours: number | string | null
  location: string | null
  price: string | number | null
  min_players: number | string | null
  max_players: number | string | null
  current_players: number | string
  additional_notes: string | null
  status: AdventureStatus
  sync_code: string
  tg_group_id: string | null
  tg_invite_link: string | null
  poster_url: string | null
  logo_url: string | null
  logo_position_json: string | null
  created_at: string | null
  updated_at: string | null
}

/** Данные шагов 1–2 визарда Мастера. */
export interface AdventureDraftPayload {
  title: string
  description?: string
  system?: string
  is_online?: boolean
  player_level?: string
  game_date?: string
  game_time?: string
  duration_hours?: number
  location?: string
  price?: number | string
  min_players?: number
  max_players?: number
  additional_notes?: string
}

export interface AdventureDraftResponse {
  success: boolean
  adventure_id: string
  sync_code: string
}

export interface DraftStatusResponse {
  status: AdventureStatus
  tg_group_id: string | null
  tg_invite_link: string | null
}

export interface AdventureLogoPosition {
  /** Вертикальное положение логотипа в процентах (0–80). */
  top: number
}

export interface PublishAdventurePayload {
  adventure_id: string
  poster_url?: string
  logo_url?: string
  logo_position_json?: string
}

export interface AdventureListResponse {
  adventures: Adventure[]
}

/** Ошибка API: `code` приходит от бэкенда (`VALIDATION_ERROR`, `INVALID_CREDENTIALS`, …). */
export class ApiError extends Error {
  readonly status: number = 500
  readonly code: string = 'INTERNAL_ERROR'

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  route: string
  body?: unknown
  token?: string | null
  query?: Record<string, string | number | undefined>
}

interface ErrorPayload {
  error?: string
  message?: string
  // Формат ошибок платформы Yandex Cloud (например, 403 Forbidden от прямого вызова)
  errorMessage?: string
  errorCode?: number
}

async function request<T>({ method, route, body, token, query }: RequestOptions): Promise<T> {
  const url = new URL(API_BASE_URL)
  url.searchParams.set(ROUTE_QUERY_PARAM, route)

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  }

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  if (token) {
    headers[AUTH_TOKEN_HEADER] = token
  }

  let response: Response
  try {
    response = await fetch(url.toString(), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Нет связи с сервером. Проверьте соединение и попробуйте снова.')
  }

  const raw = await response.text()
  let payload: unknown
  if (raw) {
    try {
      payload = JSON.parse(raw)
    } catch {
      payload = undefined
    }
  }

  if (!response.ok) {
    const errorPayload: ErrorPayload = (payload ?? {}) as ErrorPayload
    throw new ApiError(
      response.status,
      errorPayload.error ?? `HTTP_${response.status}`,
      errorPayload.message ?? errorPayload.errorMessage ?? 'Не удалось выполнить запрос',
    )
  }

  return payload as T
}

/**
 * Убирает незаполненные поля: `undefined` и пустые строки не отправляем,
 * а вот `null` сохраняем — для бэкенда это команда «очистить поле».
 */
function omitEmpty<T extends object>(payload: T): Partial<T> {
  const entries = Object.entries(payload as Record<string, unknown>)
  const filled = entries.filter(([, value]) => value !== undefined && value !== '')
  return Object.fromEntries(filled) as Partial<T>
}

export const api = {
  ping: () => request<{ status: string; time: number }>({ method: 'GET', route: '/ping' }),

  register: (data: RegisterPayload) =>
    request<AuthResponse>({
      method: 'POST',
      route: '/auth/register',
      body: omitEmpty({ ...data }),
    }),

  login: (data: LoginPayload) => request<AuthResponse>({ method: 'POST', route: '/auth/login', body: data }),

  getMe: (token: string) => request<{ user: ApiUser }>({ method: 'GET', route: '/auth/me', token }),

  updateMe: (data: UpdateProfilePayload, token: string) =>
    request<{ user: ApiUser }>({ method: 'PUT', route: '/auth/me', body: omitEmpty({ ...data }), token }),

  deleteMe: (token: string) => request<{ success: boolean }>({ method: 'DELETE', route: '/auth/me', token }),

  createAdventureDraft: (data: AdventureDraftPayload, token: string) =>
    request<AdventureDraftResponse>({ method: 'POST', route: '/adventures/draft', body: omitEmpty({ ...data }), token }),

  getDraftStatus: (adventureId: string, token: string) =>
    request<DraftStatusResponse>({
      method: 'GET',
      route: '/adventures/draft-status',
      query: { adventure_id: adventureId },
      token,
    }),

  publishAdventure: (data: PublishAdventurePayload, token: string) =>
    request<{ success: boolean; adventure: Adventure }>({
      method: 'POST',
      route: '/adventures/publish',
      body: omitEmpty({ ...data }),
      token,
    }),

  getAdventures: () => request<AdventureListResponse>({ method: 'GET', route: '/adventures' }),
}
