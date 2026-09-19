/**
 * «Подземелья Пединбурга» — serverless API для Yandex Cloud Functions (Node.js 22) + YDB.
 *
 * Роуты:
 *   GET    /ping           — проверка живости
 *   POST   /auth/register  — регистрация (роль master при верном master_code)
 *   POST   /auth/login     — вход
 *   GET    /auth/me        — профиль текущего пользователя
 *   PUT    /auth/me        — обновление профиля
 *   DELETE /auth/me        — удаление аккаунта
 *
 * Переменные окружения: YDB_ENDPOINT, YDB_DATABASE, JWT_SECRET, MASTER_INVITE_CODE,
 * JWT_EXPIRES_IN (опц., по умолчанию 30d), API_PATH_PREFIX (опц.), YDB_AUTO_MIGRATE (опц.).
 */

// ydb-sdk 5.x публикуется как CommonJS, поэтому единственный надёжный способ получить
// Driver в ESM — default-import пакета с последующей деструктуризацией.
import ydbSdk from 'ydb-sdk'
import { compare as comparePassword, hash as hashPassword } from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'

const {
  Driver,
  MetadataAuthService,
  TableDescription,
  TableIndex,
  Column,
  AlterTableDescription,
  TypedData,
  TypedValues,
  Types,
} = ydbSdk

// ─── Конфигурация ────────────────────────────────────────────────────────────

const USERS_TABLE = 'users'
const USERS_EMAIL_INDEX = 'idx_users_email'
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d'
const BCRYPT_ROUNDS = 10
const DRIVER_READY_TIMEOUT_MS = 10000
const AUTO_MIGRATE = process.env.YDB_AUTO_MIGRATE !== 'false'
const PATH_PREFIX = (process.env.API_PATH_PREFIX || '').replace(/\/+$/, '')

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS, GET, POST, PUT, DELETE',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const ROUTES = {
  '/ping': ['GET'],
  '/auth/register': ['POST'],
  '/auth/login': ['POST'],
  '/auth/me': ['GET', 'PUT', 'DELETE'],
}

// ─── Ошибки и ответы ─────────────────────────────────────────────────────────

class ApiError extends Error {
  constructor(statusCode, code, message) {
    super(message)
    this.statusCode = statusCode
    this.code = code
  }
}

function json(statusCode, payload, extraHeaders = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS, ...extraHeaders },
    isBase64Encoded: false,
    body: JSON.stringify(payload),
  }
}

function fail(statusCode, code, message, extraHeaders) {
  return json(statusCode, { error: code, message }, extraHeaders)
}

// ─── Синглтон подключения к YDB ──────────────────────────────────────────────

let driverInstance = null

function getDriver() {
  if (!driverInstance) {
    const endpoint = process.env.YDB_ENDPOINT
    const database = process.env.YDB_DATABASE
    if (!endpoint || !database) {
      throw new ApiError(500, 'CONFIG_ERROR', 'Не заданы переменные окружения YDB_ENDPOINT и/или YDB_DATABASE')
    }
    driverInstance = new Driver({
      endpoint,
      database,
      authService: new MetadataAuthService(),
    })
  }
  return driverInstance
}

/**
 * Открывает сессию YDB (соединение/драйвер переиспользуются между вызовами
 * в рамках одного инстанса функции).
 */
async function withSession(fn) {
  const driver = getDriver()
  const ready = await driver.ready(DRIVER_READY_TIMEOUT_MS)
  if (!ready) {
    throw new ApiError(503, 'YDB_NOT_READY', 'Не удалось подключиться к YDB: проверьте YDB_ENDPOINT и YDB_DATABASE')
  }
  return driver.tableClient.withSession(fn)
}

// ─── Схема данных и миграция ─────────────────────────────────────────────────

const USER_COLUMNS = [
  'id',
  'email',
  'password_hash',
  'name',
  'role',
  'gender',
  'birth_date',
  'telegram_username',
  'avatar_url',
  'created_at',
  'updated_at',
].join(', ')

function usersTableDescription() {
  return new TableDescription()
    .withColumns(
      new Column('id', Types.UUID),
      new Column('email', Types.UTF8),
      new Column('password_hash', Types.UTF8),
      new Column('name', Types.UTF8),
      new Column('role', Types.UTF8),
      new Column('gender', Types.optional(Types.UTF8)),
      new Column('birth_date', Types.optional(Types.UTF8)),
      new Column('telegram_username', Types.optional(Types.UTF8)),
      new Column('avatar_url', Types.optional(Types.UTF8)),
      new Column('created_at', Types.TIMESTAMP),
      new Column('updated_at', Types.TIMESTAMP),
    )
    .withPrimaryKey('id')
    .withIndex(new TableIndex(USERS_EMAIL_INDEX).withIndexColumns('email').withGlobalUnique())
}

async function migrate(session) {
  let tableExists = true
  try {
    await session.describeTable(USERS_TABLE)
  } catch {
    tableExists = false
  }

  if (!tableExists) {
    await session.createTable(USERS_TABLE, usersTableDescription())
    return
  }

  const described = await session.describeTable(USERS_TABLE)
  const hasEmailIndex = (described.indexes || []).some((index) => index.name === USERS_EMAIL_INDEX)
  if (!hasEmailIndex) {
    const alter = new AlterTableDescription()
    alter.addIndexes.push(new TableIndex(USERS_EMAIL_INDEX).withIndexColumns('email').withGlobalUnique())
    await session.alterTable(USERS_TABLE, alter)
  }
}

let schemaPromise = null

/** Один раз на инстанс функции создаёт таблицу users и индекс idx_users_email. */
function ensureSchema() {
  if (!AUTO_MIGRATE) {
    return Promise.resolve()
  }
  if (!schemaPromise) {
    schemaPromise = withSession((session) => migrate(session)).catch((error) => {
      schemaPromise = null // даём следующему запросу шанс повторить миграцию
      throw error
    })
  }
  return schemaPromise
}

// ─── Запросы к YDB ───────────────────────────────────────────────────────────

function optionalUtf8(value) {
  return value === null || value === undefined ? TypedValues.optionalNull(Types.UTF8) : TypedValues.optional(TypedValues.utf8(value))
}

async function selectRows(session, yql, params) {
  const { resultSets } = await session.executeQuery(yql, params)
  const resultSet = resultSets && resultSets[0]
  if (!resultSet || !resultSet.rows || resultSet.rows.length === 0) {
    return []
  }
  return TypedData.createNativeObjects(resultSet)
}

async function findUserByEmail(session, email) {
  // Обращаемся к таблице через индекс idx_users_email.
  const yql = `
DECLARE $email AS Utf8;
SELECT ${USER_COLUMNS} FROM ${USERS_TABLE} VIEW ${USERS_EMAIL_INDEX} WHERE email = $email;`
  const rows = await selectRows(session, yql, { $email: TypedValues.utf8(email) })
  return rows[0] || null
}

async function findUserById(session, id) {
  const yql = `
DECLARE $id AS Uuid;
SELECT ${USER_COLUMNS} FROM ${USERS_TABLE} WHERE id = $id;`
  const rows = await selectRows(session, yql, { $id: TypedValues.uuid(id) })
  return rows[0] || null
}

async function insertUser(session, record) {
  const yql = `
DECLARE $id AS Uuid;
DECLARE $email AS Utf8;
DECLARE $password_hash AS Utf8;
DECLARE $name AS Utf8;
DECLARE $role AS Utf8;
DECLARE $gender AS Utf8?;
DECLARE $birth_date AS Utf8?;
DECLARE $telegram_username AS Utf8?;
DECLARE $avatar_url AS Utf8?;
DECLARE $created_at AS Timestamp;
DECLARE $updated_at AS Timestamp;
INSERT INTO ${USERS_TABLE}
  (id, email, password_hash, name, role, gender, birth_date, telegram_username, avatar_url, created_at, updated_at)
VALUES
  ($id, $email, $password_hash, $name, $role, $gender, $birth_date, $telegram_username, $avatar_url, $created_at, $updated_at);`

  await session.executeQuery(yql, {
    $id: TypedValues.uuid(record.id),
    $email: TypedValues.utf8(record.email),
    $password_hash: TypedValues.utf8(record.password_hash),
    $name: TypedValues.utf8(record.name),
    $role: TypedValues.utf8(record.role),
    $gender: optionalUtf8(record.gender),
    $birth_date: optionalUtf8(record.birth_date),
    $telegram_username: optionalUtf8(record.telegram_username),
    $avatar_url: optionalUtf8(record.avatar_url),
    $created_at: TypedValues.timestamp(record.created_at),
    $updated_at: TypedValues.timestamp(record.updated_at),
  })
}

async function updateUser(session, id, patch) {
  const declares = ['DECLARE $id AS Uuid;', 'DECLARE $updated_at AS Timestamp;']
  const assignments = ['updated_at = $updated_at']
  const params = { $id: TypedValues.uuid(id), $updated_at: TypedValues.timestamp(new Date()) }

  for (const [field, value] of Object.entries(patch)) {
    const param = `$${field}`
    if (value === null) {
      declares.push(`DECLARE ${param} AS Utf8?;`)
      params[param] = TypedValues.optionalNull(Types.UTF8)
    } else {
      declares.push(`DECLARE ${param} AS Utf8;`)
      params[param] = TypedValues.utf8(value)
    }
    assignments.push(`${field} = ${param}`)
  }

  const yql = `
${declares.join('\n')}
UPDATE ${USERS_TABLE} SET ${assignments.join(', ')} WHERE id = $id;`
  await session.executeQuery(yql, params)
}

async function deleteUser(session, id) {
  const yql = `
DECLARE $id AS Uuid;
DELETE FROM ${USERS_TABLE} WHERE id = $id;`
  await session.executeQuery(yql, { $id: TypedValues.uuid(id) })
}

// ─── Валидация и нормализация ────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const BIRTH_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TELEGRAM_RE = /^[A-Za-z0-9_]{3,32}$/
const GENDERS = ['male', 'female', 'other']

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key)

function asTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function validationError(message) {
  return new ApiError(400, 'VALIDATION_ERROR', message)
}

function normalizeEmail(value) {
  const email = asTrimmedString(value).toLowerCase()
  if (!EMAIL_RE.test(email)) {
    throw validationError('Некорректный email')
  }
  return email
}

function normalizePassword(value) {
  const password = typeof value === 'string' ? value : ''
  if (password.length < 6) {
    throw validationError('Пароль должен содержать минимум 6 символов')
  }
  return password
}

function normalizeName(value) {
  const name = asTrimmedString(value)
  if (!name) {
    throw validationError('Укажите имя')
  }
  if (name.length > 64) {
    throw validationError('Имя не должно превышать 64 символа')
  }
  return name
}

function normalizeGender(value) {
  const gender = asTrimmedString(value).toLowerCase()
  if (!gender) {
    return null
  }
  if (!GENDERS.includes(gender)) {
    throw validationError(`gender должен быть одним из: ${GENDERS.join(', ')}`)
  }
  return gender
}

function normalizeBirthDate(value) {
  const birthDate = asTrimmedString(value)
  if (!birthDate) {
    return null
  }
  if (!BIRTH_DATE_RE.test(birthDate) || Number.isNaN(Date.parse(birthDate))) {
    throw validationError('birth_date должен быть в формате YYYY-MM-DD')
  }
  if (Date.parse(birthDate) > Date.now()) {
    throw validationError('birth_date не может быть в будущем')
  }
  return birthDate
}

function normalizeTelegramUsername(value) {
  const username = asTrimmedString(value).replace(/^@+/, '')
  if (!username) {
    return null
  }
  if (!TELEGRAM_RE.test(username)) {
    throw validationError('telegram_username: 3–32 символа (латиница, цифры, подчёркивание)')
  }
  return username
}

function normalizeAvatarUrl(value) {
  const url = asTrimmedString(value)
  if (!url) {
    return null
  }
  if (url.length > 512) {
    throw validationError('avatar_url не должен превышать 512 символов')
  }
  return url
}

function isMasterCode(value) {
  const expected = process.env.MASTER_INVITE_CODE
  return Boolean(expected) && asTrimmedString(value) === expected
}

function buildProfilePatch(body) {
  const patch = {}

  if (hasOwn(body, 'name')) {
    patch.name = normalizeName(body.name)
  }
  if (hasOwn(body, 'gender')) {
    patch.gender = normalizeGender(body.gender)
  }
  if (hasOwn(body, 'birth_date')) {
    patch.birth_date = normalizeBirthDate(body.birth_date)
  }
  if (hasOwn(body, 'telegram_username')) {
    patch.telegram_username = normalizeTelegramUsername(body.telegram_username)
  }
  if (hasOwn(body, 'avatar_url') || hasOwn(body, 'avatar')) {
    patch.avatar_url = normalizeAvatarUrl(body.avatar_url !== undefined ? body.avatar_url : body.avatar)
  }

  if (Object.keys(patch).length === 0) {
    throw validationError('Нет полей для обновления: name, gender, birth_date, telegram_username, avatar_url')
  }
  return patch
}

// ─── Представление пользователя ──────────────────────────────────────────────

function toIsoString(value) {
  if (value instanceof Date) {
    return value.toISOString()
  }
  return typeof value === 'string' ? value : null
}

/** Публичный профиль без password_hash. */
function toPublicUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    gender: row.gender || null,
    birth_date: row.birth_date || null,
    telegram_username: row.telegram_username || null,
    avatar_url: row.avatar_url || null,
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
  }
}

// ─── Авторизация (JWT) ───────────────────────────────────────────────────────

function getJwtSecret() {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new ApiError(500, 'CONFIG_ERROR', 'Не задана переменная окружения JWT_SECRET')
  }
  return secret
}

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, getJwtSecret(), {
    expiresIn: JWT_EXPIRES_IN,
  })
}

function getHeader(event, name) {
  const headers = event.headers || {}
  const key = Object.keys(headers).find((header) => header.toLowerCase() === name.toLowerCase())
  return key ? headers[key] : undefined
}

function authenticate(event) {
  const secret = getJwtSecret()
  const header = asTrimmedString(getHeader(event, 'authorization'))
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
  if (!token) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Требуется заголовок Authorization: Bearer <token>')
  }
  try {
    return jwt.verify(token, secret)
  } catch {
    throw new ApiError(401, 'INVALID_TOKEN', 'Токен недействителен или истёк')
  }
}

// ─── Обработчики роутов ──────────────────────────────────────────────────────

async function requireUserRow(session, id) {
  const row = await findUserById(session, id)
  if (!row) {
    throw new ApiError(404, 'USER_NOT_FOUND', 'Пользователь не найден')
  }
  return row
}

async function handleRegister(body) {
  const email = normalizeEmail(body.email)
  const password = normalizePassword(body.password)
  const name = normalizeName(body.name)
  const gender = normalizeGender(body.gender)
  const birthDate = normalizeBirthDate(body.birth_date)
  const telegramUsername = normalizeTelegramUsername(body.telegram_username)
  const avatarUrl = normalizeAvatarUrl(body.avatar_url)
  const role = isMasterCode(body.master_code) ? 'master' : 'player'

  await ensureSchema()

  const record = await withSession(async (session) => {
    const existing = await findUserByEmail(session, email)
    if (existing) {
      throw new ApiError(409, 'EMAIL_ALREADY_EXISTS', 'Пользователь с таким email уже зарегистрирован')
    }

    const now = new Date()
    const user = {
      id: uuidv4(),
      email,
      password_hash: await hashPassword(password, BCRYPT_ROUNDS),
      name,
      role,
      gender,
      birth_date: birthDate,
      telegram_username: telegramUsername,
      avatar_url: avatarUrl,
      created_at: now,
      updated_at: now,
    }
    await insertUser(session, user)
    return user
  })

  return json(201, { token: signToken(record), user: toPublicUser(record) })
}

async function handleLogin(body) {
  const email = asTrimmedString(body.email).toLowerCase()
  const password = typeof body.password === 'string' ? body.password : ''
  if (!email || !password) {
    throw validationError('Укажите email и пароль')
  }

  await ensureSchema()

  const row = await withSession((session) => findUserByEmail(session, email))
  const invalidCredentials = new ApiError(401, 'INVALID_CREDENTIALS', 'Неверный email или пароль')
  if (!row) {
    throw invalidCredentials
  }
  if (!(await comparePassword(password, row.password_hash))) {
    throw invalidCredentials
  }

  return json(200, { token: signToken(row), user: toPublicUser(row) })
}

async function handleGetMe(event) {
  const payload = authenticate(event)
  await ensureSchema()
  const row = await withSession((session) => requireUserRow(session, payload.id))
  return json(200, { user: toPublicUser(row) })
}

async function handleUpdateMe(event, body) {
  const payload = authenticate(event)
  const patch = buildProfilePatch(body)
  await ensureSchema()
  const row = await withSession(async (session) => {
    await requireUserRow(session, payload.id)
    await updateUser(session, payload.id, patch)
    return requireUserRow(session, payload.id)
  })
  return json(200, { user: toPublicUser(row) })
}

async function handleDeleteMe(event) {
  const payload = authenticate(event)
  await ensureSchema()
  await withSession(async (session) => {
    await requireUserRow(session, payload.id)
    await deleteUser(session, payload.id)
  })
  return json(200, { success: true })
}

// ─── Разбор HTTP-запроса и роутинг ───────────────────────────────────────────

function resolveMethod(event) {
  const raw = event.httpMethod || (event.requestContext && event.requestContext.http && event.requestContext.http.method)
  return String(raw || 'GET').toUpperCase()
}

function resolvePath(event) {
  const raw =
    event.path || event.url || (event.requestContext && event.requestContext.http && event.requestContext.http.path) || '/'
  let path = String(raw).split('?')[0]
  if (PATH_PREFIX && path.startsWith(PATH_PREFIX)) {
    path = path.slice(PATH_PREFIX.length)
  }
  const trimmed = path.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

function parseBody(event) {
  const body = event.body
  if (body === undefined || body === null || body === '') {
    return {}
  }
  if (typeof body === 'object') {
    return body
  }

  const text = event.isBase64Encoded ? Buffer.from(String(body), 'base64').toString('utf8') : String(body)
  if (!text.trim()) {
    return {}
  }

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Тело запроса не является корректным JSON')
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
}

/**
 * Единый HTTP-обработчик Yandex Cloud Functions.
 *
 * @param {object} event — событие HTTP-триггера (API Gateway / Functions HTTP integration)
 * @param {object} context — контекст вызова (requestId используется в логах)
 */
export const handler = async (event, context) => {
  const method = resolveMethod(event)

  // CORS preflight: отвечаем сразу, без обращения к YDB.
  if (method === 'OPTIONS') {
    return { statusCode: 200, headers: { ...CORS_HEADERS }, isBase64Encoded: false, body: '' }
  }

  try {
    const path = resolvePath(event)
    const allowedMethods = ROUTES[path]

    if (!allowedMethods) {
      return fail(404, 'NOT_FOUND', `Роут ${method} ${path} не найден`)
    }
    if (!allowedMethods.includes(method)) {
      return fail(405, 'METHOD_NOT_ALLOWED', `Метод ${method} не поддерживается для ${path}`, {
        Allow: allowedMethods.join(', '),
      })
    }

    if (path === '/ping') {
      return json(200, { status: 'ok', time: Date.now() })
    }

    if (path === '/auth/register') {
      return await handleRegister(parseBody(event))
    }
    if (path === '/auth/login') {
      return await handleLogin(parseBody(event))
    }
    if (method === 'GET') {
      return await handleGetMe(event)
    }
    if (method === 'PUT') {
      return await handleUpdateMe(event, parseBody(event))
    }
    return await handleDeleteMe(event)
  } catch (error) {
    if (error instanceof ApiError) {
      return fail(error.statusCode, error.code, error.message)
    }
    const requestId = (context && context.requestId) || 'unknown'
    console.error(`[${requestId}] Unhandled error:`, error)
    return fail(500, 'INTERNAL_ERROR', 'Внутренняя ошибка сервера')
  }
}



