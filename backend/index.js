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
 *
 * Схема: таблица users, где первичный ключ `id` — строка Utf8 (UUID текстом, не тип Uuid).
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
  TypedData,
  TypedValues,
  Types,
} = ydbSdk

// ─── Конфигурация ────────────────────────────────────────────────────────────

const USERS_TABLE = 'users'
const USERS_EMAIL_INDEX = 'idx_users_email'
const ADVENTURES_TABLE = 'adventures'
const ADVENTURES_SYNC_INDEX = 'idx_adventures_sync_code'
const SYNC_CODE_PREFIX = 'PEDIN'
const SYNC_CODE_LENGTH = 4
// Алфавит без похожих символов (0/O, 1/I/L): код диктуют голосом в Telegram.
const SYNC_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const BOT_SECRET_HEADER = 'x-bot-secret'
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d'
const BCRYPT_ROUNDS = 10
const DRIVER_READY_TIMEOUT_MS = 10000
const AUTO_MIGRATE = process.env.YDB_AUTO_MIGRATE !== 'false'
const PATH_PREFIX = (process.env.API_PATH_PREFIX || '').replace(/\/+$/, '')
// Прямой вызов функции (без API Gateway) не пропускает подпути:
// `/<function_id>/ping` → ProxyIntegrationError. Поэтому маршрут можно передать
// query-параметром `?route=/ping` или заголовком `X-Route: /ping`.
const ROUTE_QUERY_PARAM = 'route'
// JWT передаём своим заголовком: `Authorization` при прямом вызове функции режет
// платформа Yandex Cloud (403 Forbidden: Not authorized — он зарезервирован под IAM-токен).
const AUTH_TOKEN_HEADER = 'x-auth-token'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS, GET, POST, PUT, DELETE',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Route, X-Auth-Token, X-Bot-Secret',
}

const ROUTES = {
  '/ping': ['GET'],
  '/auth/register': ['POST'],
  '/auth/login': ['POST'],
  '/auth/me': ['GET', 'PUT', 'DELETE'],
  '/adventures': ['GET'],
  '/adventures/draft': ['POST'],
  '/adventures/draft-status': ['GET'],
  '/adventures/publish': ['POST'],
  '/bot/sync': ['POST'],
  '/bot/member-update': ['POST'],
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
  let ready = false
  try {
    ready = await driver.ready(DRIVER_READY_TIMEOUT_MS)
  } catch (error) {
    logYdbError('driver.ready', error)
    throw error
  }
  if (!ready) {
    const message = `Не удалось подключиться к YDB за ${DRIVER_READY_TIMEOUT_MS} мс (проверьте YDB_ENDPOINT и YDB_DATABASE)`
    console.error('YDB_ERROR_MESSAGE:', message)
    console.error('YDB_ERROR_OPERATION:', 'driver.ready(timeout)')
    throw new ApiError(503, 'YDB_NOT_READY', message)
  }
  return driver.tableClient.withSession(fn)
}

// ─── Схема данных: id — строка Utf8 (UUID текстом, не тип Uuid) ──────────────

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
      new Column('id', Types.UTF8),
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

// Индекс может отсутствовать в уже существующей таблице — тогда ищем полным сканом.
let emailIndexAvailable = true

/**
 * Проверяет доступность таблиц. Существующие таблицы НЕ мигрируем:
 * DDL-операции (ALTER/ADD INDEX) не выполняются, чтобы не ломать рабочие данные.
 * Таблица users создаётся только если её нет вообще.
 */
async function verifySchema(session) {
  try {
    const described = await session.describeTable(USERS_TABLE)
    emailIndexAvailable = (described.indexes || []).some((index) => index.name === USERS_EMAIL_INDEX)
    if (!emailIndexAvailable) {
      console.warn(`WARN: индекс ${USERS_EMAIL_INDEX} отсутствует — поиск по email пойдёт сканированием таблицы`)
    }
  } catch (error) {
    console.warn('WARN: таблица users недоступна, пробуем создать:', error && error.message)
    await session.createTable(USERS_TABLE, usersTableDescription())
  }

  await loadAdventureSchema(session)
}

/**
 * Читает фактические типы колонок adventures (таблица создаётся вне обработчика).
 * По ним формируются параметры запросов, поэтому различия в схеме не ломают API.
 */
async function loadAdventureSchema(session) {
  try {
    const described = await session.describeTable(ADVENTURES_TABLE)
    const types = {}
    for (const column of described.columns || []) {
      const typeId = unwrapTypeId(column.type)
      if (column.name && typeId) {
        types[column.name] = typeId
      }
    }
    adventureColumnTypes = types
    const readable = Object.fromEntries(
      Object.entries(types).map(([column, typeId]) => [column, TYPE_NAMES_BY_ID.get(typeId) || typeId]),
    )
    console.log('INFO: типы колонок adventures:', JSON.stringify(readable))
  } catch (error) {
    console.warn('WARN: не удалось прочитать схему adventures, используем типы по умолчанию:', error && error.message)
    adventureColumnTypes = {}
  }
}

let schemaPromise = null

/** Один раз на инстанс функции проверяет, что таблица users доступна. */
function ensureSchema() {
  if (!AUTO_MIGRATE) {
    return Promise.resolve()
  }
  if (!schemaPromise) {
    schemaPromise = withSession((session) => verifySchema(session)).catch((error) => {
      logYdbError('verifySchema', error)
      schemaPromise = null // даём следующему запросу шанс повторить проверку
      throw error
    })
  }
  return schemaPromise
}

// ─── Запросы к YDB ───────────────────────────────────────────────────────────

function optionalUtf8(value) {
  return value === null || value === undefined ? TypedValues.optionalNull(Types.UTF8) : TypedValues.optional(TypedValues.utf8(value))
}

// ─── Диагностика ─────────────────────────────────────────────────────────────

/**
 * Печатает причину ошибки YDB одной строкой — так её сразу видно в логах Cloud Functions.
 */
function logYdbError(operation, error) {
  const message = error && error.message ? error.message : String(error)
  console.error('YDB_ERROR_MESSAGE:', message)
  if (error && error.issues) {
    console.error('YDB_ISSUES:', JSON.stringify(error.issues))
  }
  console.error('YDB_ERROR_OPERATION:', operation)
}

// Ошибки сети/метаданных из SDK всплывают вне наших try/catch: логируем их,
// чтобы инстанс функции не завершался из-за «unhandled rejection».
process.on('unhandledRejection', (reason) => {
  logYdbError('unhandledRejection', reason)
})

/** Выполняет YQL-запрос и логирует ошибки YDB с контекстом операции. */
async function executeYql(session, operation, yql, params) {
  try {
    const { resultSets } = await session.executeQuery(yql, params)
    return resultSets || []
  } catch (error) {
    logYdbError(operation, error)
    throw error
  }
}

async function selectRows(session, operation, yql, params) {
  const resultSets = await executeYql(session, operation, yql, params)
  const resultSet = resultSets[0]
  if (!resultSet || !resultSet.rows || resultSet.rows.length === 0) {
    return []
  }
  return TypedData.createNativeObjects(resultSet)
}

function buildFindUserByEmailYql(useIndex) {
  const source = useIndex ? `${USERS_TABLE} VIEW ${USERS_EMAIL_INDEX}` : USERS_TABLE
  return `
DECLARE $email AS Utf8;
SELECT ${USER_COLUMNS} FROM ${source} WHERE email = $email;`
}

async function findUserByEmail(session, email) {
  const params = { $email: TypedValues.utf8(email) }

  if (emailIndexAvailable) {
    try {
      const rows = await selectRows(session, 'findUserByEmail(index)', buildFindUserByEmailYql(true), params)
      return rows[0] || null
    } catch (error) {
      // Индекса может не быть в уже существующей таблице — переходим на скан.
      emailIndexAvailable = false
      console.warn('WARN: поиск через индекс не удался, используем сканирование таблицы:', error && error.message)
    }
  }

  const rows = await selectRows(session, 'findUserByEmail(scan)', buildFindUserByEmailYql(false), params)
  return rows[0] || null
}

async function findUserById(session, id) {
  // id хранится и передаётся строго как Utf8-строка (UUID текстом).
  const yql = `
DECLARE $id AS Utf8;
SELECT ${USER_COLUMNS} FROM ${USERS_TABLE} WHERE id = $id;`
  const rows = await selectRows(session, 'findUserById', yql, { $id: TypedValues.utf8(id) })
  return rows[0] || null
}

async function insertUser(session, record) {
  const yql = `
DECLARE $id AS Utf8;
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

  await executeYql(session, 'insertUser', yql, {
    $id: TypedValues.utf8(record.id),
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

// Колонки таблицы типа Utf8? (nullable): и значение, и NULL передаём типом Utf8?.
const NULLABLE_USER_FIELDS = ['gender', 'birth_date', 'telegram_username', 'avatar_url']

async function updateUser(session, id, patch) {
  const declares = ['DECLARE $id AS Utf8;', 'DECLARE $updated_at AS Timestamp;']
  const assignments = ['updated_at = $updated_at']
  const params = { $id: TypedValues.utf8(id), $updated_at: TypedValues.timestamp(new Date()) }

  for (const [field, value] of Object.entries(patch)) {
    const param = `$${field}`
    if (NULLABLE_USER_FIELDS.includes(field)) {
      declares.push(`DECLARE ${param} AS Utf8?;`)
      params[param] = value ? TypedValues.optional(TypedValues.utf8(value)) : TypedValues.optionalNull(Types.UTF8)
    } else {
      declares.push(`DECLARE ${param} AS Utf8;`)
      params[param] = TypedValues.utf8(value)
    }
    assignments.push(`${field} = ${param}`)
  }

  const yql = `
${declares.join('\n')}
UPDATE ${USERS_TABLE} SET ${assignments.join(', ')} WHERE id = $id;`
  await executeYql(session, 'updateUser', yql, params)
}

async function deleteUser(session, id) {
  const yql = `
DECLARE $id AS Utf8;
DELETE FROM ${USERS_TABLE} WHERE id = $id;`
  await executeYql(session, 'deleteUser', yql, { $id: TypedValues.utf8(id) })
}

// ─── Приключения: схема, код синхронизации и типы ────────────────────────────

const ADVENTURE_COLUMNS = [
  'id',
  'master_id',
  'master_name',
  'title',
  'description',
  'system',
  'is_online',
  'player_level',
  'game_date',
  'game_time',
  'duration_hours',
  'location',
  'price',
  'min_players',
  'max_players',
  'current_players',
  'additional_notes',
  'status',
  'sync_code',
  'tg_group_id',
  'tg_invite_link',
  'poster_url',
  'logo_url',
  'logo_position_json',
  'created_at',
  'updated_at',
].join(', ')

// Типы по умолчанию: используются, если схему не удалось прочитать через describeTable.
const ADVENTURE_TYPE_FALLBACK = {
  is_online: 'BOOL',
  duration_hours: 'UINT32',
  min_players: 'UINT32',
  max_players: 'UINT32',
  current_players: 'UINT32',
  created_at: 'TIMESTAMP',
  updated_at: 'TIMESTAMP',
}

// YQL-имена типов: 'UINT32' → 'Uint32', 'TZ_DATE' → 'TzDate'
const TYPE_NAMES_BY_ID = new Map(
  Object.entries(Types)
    .filter(([, type]) => type && typeof type.typeId === 'number')
    .map(([name, type]) => [
      type.typeId,
      name
        .toLowerCase()
        .split('_')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(''),
    ]),
)

const TYPES_BY_ID = new Map(
  Object.entries(Types)
    .filter(([, type]) => type && typeof type.typeId === 'number')
    .map(([, type]) => [type.typeId, type]),
)

const TYPE_IDS_BY_NAME = new Map([...TYPE_NAMES_BY_ID].map(([typeId, name]) => [name.toUpperCase(), typeId]))

// У SDK `Types.TEXT` — алиас `Types.UTF8` с тем же typeId, поэтому после сборки карты
// закрепляем YQL-имя «Utf8» (иначе в DECLARE попало бы `Text`).
TYPE_NAMES_BY_ID.set(Types.UTF8.typeId, 'Utf8')
TYPE_IDS_BY_NAME.set('UTF8', Types.UTF8.typeId)

// Значения 64-битных и вещественных типов задаём «сырым» протобаф-значением:
// статических фабрик для них в TypedValues нет.
const RAW_NUMBER_VALUE_KEYS = new Map([
  [Types.INT8.typeId, 'int32Value'],
  [Types.INT16.typeId, 'int32Value'],
  [Types.INT64.typeId, 'int64Value'],
  [Types.UINT8.typeId, 'uint32Value'],
  [Types.UINT16.typeId, 'uint32Value'],
  [Types.FLOAT.typeId, 'floatValue'],
  [Types.DOUBLE.typeId, 'doubleValue'],
])

// Фактические типы колонок adventures — заполняются в verifySchema (describeTable).
let adventureColumnTypes = {}

function unwrapTypeId(type) {
  if (!type) return null
  if (typeof type.typeId === 'number') return type.typeId
  if (type.optionalType && type.optionalType.item) return unwrapTypeId(type.optionalType.item)
  return null
}

function resolveAdventureTypeId(column) {
  const actual = adventureColumnTypes[column]
  if (actual) return actual
  const fallbackName = ADVENTURE_TYPE_FALLBACK[column]
  if (fallbackName && TYPE_IDS_BY_NAME.has(fallbackName)) return TYPE_IDS_BY_NAME.get(fallbackName)
  return Types.UTF8.typeId
}

/** YQL-имя типа параметра для колонки (`Utf8`, `Uint32?`, …). */
function adventureParamType(column, value) {
  const name = TYPE_NAMES_BY_ID.get(resolveAdventureTypeId(column)) || 'Utf8'
  return value === null || value === undefined ? `${name}?` : name
}

function toDate(value) {
  return value instanceof Date ? value : new Date(value)
}

/** Типизированное значение под фактический тип колонки. */
function encodeAdventureValue(column, value) {
  const typeId = resolveAdventureTypeId(column)

  if (typeId === Types.BOOL.typeId) return TypedValues.bool(Boolean(value))
  if (typeId === Types.TIMESTAMP.typeId) return TypedValues.timestamp(toDate(value))
  if (typeId === Types.DATETIME.typeId) return TypedValues.datetime(toDate(value))
  if (typeId === Types.DATE.typeId) return TypedValues.date(toDate(value))
  if (typeId === Types.UINT32.typeId) return TypedValues.uint32(Number(value))
  if (typeId === Types.UINT64.typeId) return TypedValues.uint64(Number(value))
  if (typeId === Types.INT32.typeId) return TypedValues.int32(Number(value))

  const rawKey = RAW_NUMBER_VALUE_KEYS.get(typeId)
  if (rawKey) {
    return { type: { typeId }, value: { [rawKey]: Number(value) } }
  }

  // Utf8, Text, Json, Yson, Uuid и остальные — строкой
  return TypedValues.utf8(String(value))
}

function encodeAdventureParam(column, value) {
  if (value === null || value === undefined) {
    const baseType = TYPES_BY_ID.get(resolveAdventureTypeId(column)) || Types.UTF8
    return TypedValues.optionalNull(baseType)
  }
  return encodeAdventureValue(column, value)
}

/** Код синхронизации вида «PEDIN-4819». */
function generateSyncCode() {
  let suffix = ''
  for (let index = 0; index < SYNC_CODE_LENGTH; index += 1) {
    suffix += SYNC_CODE_ALPHABET[Math.floor(Math.random() * SYNC_CODE_ALPHABET.length)]
  }
  return `${SYNC_CODE_PREFIX}-${suffix}`
}

// ─── Запросы к таблице adventures ────────────────────────────────────────────

async function findAdventureById(session, id) {
  const yql = `
DECLARE $id AS Utf8;
SELECT ${ADVENTURE_COLUMNS} FROM ${ADVENTURES_TABLE} WHERE id = $id;`
  const rows = await selectRows(session, 'findAdventureById', yql, { $id: TypedValues.utf8(id) })
  return rows[0] || null
}

async function findAdventureBySyncCode(session, syncCode) {
  const yql = `
DECLARE $sync_code AS Utf8;
SELECT ${ADVENTURE_COLUMNS} FROM ${ADVENTURES_TABLE} VIEW ${ADVENTURES_SYNC_INDEX} WHERE sync_code = $sync_code;`
  const rows = await selectRows(session, 'findAdventureBySyncCode', yql, { $sync_code: TypedValues.utf8(syncCode) })
  return rows[0] || null
}

async function findAdventureByTgGroupId(session, tgGroupId) {
  const yql = `
DECLARE $tg_group_id AS Utf8;
DECLARE $status_active AS Utf8;
DECLARE $status_synced AS Utf8;
SELECT ${ADVENTURE_COLUMNS} FROM ${ADVENTURES_TABLE}
WHERE tg_group_id = $tg_group_id AND status IN ($status_active, $status_synced)
LIMIT 1;`
  const rows = await selectRows(session, 'findAdventureByTgGroupId', yql, {
    $tg_group_id: TypedValues.utf8(tgGroupId),
    $status_active: TypedValues.utf8('active'),
    $status_synced: TypedValues.utf8('synced'),
  })
  return rows[0] || null
}

async function listActiveAdventures(session) {
  const yql = `
DECLARE $status AS Utf8;
SELECT ${ADVENTURE_COLUMNS} FROM ${ADVENTURES_TABLE}
WHERE status = $status
ORDER BY game_date, game_time;`
  return selectRows(session, 'listActiveAdventures', yql, { $status: TypedValues.utf8('active') })
}

async function insertAdventure(session, record) {
  const entries = Object.entries(record).filter(([, value]) => value !== undefined)
  const declares = entries.map(([column, value]) => `DECLARE $${column} AS ${adventureParamType(column, value)};`)
  const params = {}
  for (const [column, value] of entries) {
    params[`$${column}`] = encodeAdventureParam(column, value)
  }

  const yql = `
${declares.join('\n')}
INSERT INTO ${ADVENTURES_TABLE} (${entries.map(([column]) => column).join(', ')})
VALUES (${entries.map(([column]) => `$${column}`).join(', ')});`
  await executeYql(session, 'insertAdventure', yql, params)
}

async function updateAdventure(session, id, patch) {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined)
  const declares = ['DECLARE $id AS Utf8;']
  const params = { $id: TypedValues.utf8(id) }
  const assignments = []

  for (const [column, value] of entries) {
    declares.push(`DECLARE $${column} AS ${adventureParamType(column, value)};`)
    params[`$${column}`] = encodeAdventureParam(column, value)
    assignments.push(`${column} = $${column}`)
  }

  const yql = `
${declares.join('\n')}
UPDATE ${ADVENTURES_TABLE} SET ${assignments.join(', ')} WHERE id = $id;`
  await executeYql(session, 'updateAdventure', yql, params)
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

/** Достаёт JWT из заголовка X-Auth-Token (Authorization: Bearer — как фолбэк). */
function getAuthToken(event) {
  const customHeader = asTrimmedString(getHeader(event, AUTH_TOKEN_HEADER))
  if (customHeader) {
    return customHeader.replace(/^Bearer\s+/i, '').trim()
  }
  const authorization = asTrimmedString(getHeader(event, 'authorization'))
  return authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : ''
}

function authenticate(event) {
  const secret = getJwtSecret()
  const token = getAuthToken(event)
  if (!token) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Требуется токен в заголовке X-Auth-Token (или Authorization: Bearer <token>)')
  }
  try {
    return jwt.verify(token, secret)
  } catch {
    throw new ApiError(401, 'INVALID_TOKEN', 'Токен недействителен или истёк')
  }
}

// ─── Валидация и представление приключений ───────────────────────────────────

const GAME_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function optionalText(value, maxLength = 2000) {
  const text = typeof value === 'number' ? String(value) : asTrimmedString(value)
  if (!text) return undefined
  return text.length > maxLength ? text.slice(0, maxLength) : text
}

function optionalJsonText(value, maxLength = 2000) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'object') return JSON.stringify(value).slice(0, maxLength)
  return optionalText(value, maxLength)
}

function optionalNumber(value, { min = 0, max = 1000 } = {}) {
  if (value === undefined || value === null || value === '') return undefined
  const number = Number(value)
  if (!Number.isFinite(number)) {
    throw validationError(`Ожидалось число, получено «${value}»`)
  }
  return Math.min(Math.max(Math.trunc(number), min), max)
}

function optionalBoolean(value) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'boolean') return value
  const normalized = asTrimmedString(value).toLowerCase()
  if (['true', '1', 'yes', 'online', 'да'].includes(normalized)) return true
  if (['false', '0', 'no', 'offline', 'нет'].includes(normalized)) return false
  throw validationError('is_online должен быть true или false')
}

/** Данные шагов 1–2 визарда → колонки таблицы adventures. */
function buildAdventureDraft(body) {
  const title = optionalText(body.title, 200)
  if (!title) {
    throw validationError('Укажите название приключения')
  }

  const gameDate = optionalText(body.game_date, 32)
  if (gameDate && !GAME_DATE_RE.test(gameDate)) {
    throw validationError('game_date должен быть в формате YYYY-MM-DD')
  }

  const minPlayers = optionalNumber(body.min_players, { min: 1, max: 100 })
  const maxPlayers = optionalNumber(body.max_players, { min: 1, max: 100 })
  if (minPlayers !== undefined && maxPlayers !== undefined && minPlayers > maxPlayers) {
    throw validationError('min_players не может быть больше max_players')
  }

  return {
    title,
    description: optionalText(body.description, 5000),
    system: optionalText(body.system, 100),
    is_online: optionalBoolean(body.is_online),
    player_level: optionalText(body.player_level, 100),
    game_date: gameDate,
    game_time: optionalText(body.game_time, 16),
    duration_hours: optionalNumber(body.duration_hours, { min: 1, max: 72 }),
    location: optionalText(body.location, 300),
    price: optionalText(body.price, 100),
    min_players: minPlayers,
    max_players: maxPlayers,
    additional_notes: optionalText(body.additional_notes, 5000),
  }
}

function toPublicAdventure(row) {
  return {
    id: row.id,
    master_id: row.master_id,
    master_name: row.master_name,
    title: row.title,
    description: row.description ?? null,
    system: row.system ?? null,
    is_online: row.is_online ?? null,
    player_level: row.player_level ?? null,
    game_date: row.game_date ?? null,
    game_time: row.game_time ?? null,
    duration_hours: row.duration_hours ?? null,
    location: row.location ?? null,
    price: row.price ?? null,
    min_players: row.min_players ?? null,
    max_players: row.max_players ?? null,
    current_players: row.current_players ?? 0,
    additional_notes: row.additional_notes ?? null,
    status: row.status,
    sync_code: row.sync_code,
    tg_group_id: row.tg_group_id ?? null,
    tg_invite_link: row.tg_invite_link ?? null,
    poster_url: row.poster_url ?? null,
    logo_url: row.logo_url ?? null,
    logo_position_json: row.logo_position_json ?? null,
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
  }
}

/** Число игроков: не меньше 0 и не больше max_players (если он задан). */
function clampPlayers(value, maxPlayers) {
  const numeric = Number(value)
  const base = Number.isFinite(numeric) ? Math.trunc(numeric) : 0
  if (base < 0) return 0
  const limit = Number(maxPlayers)
  if (Number.isFinite(limit) && limit > 0 && base > limit) return limit
  return base
}

function isConflictError(error) {
  const message = String((error && error.message) || '')
  return /conflict|already exists|precondition|duplicate/i.test(message)
}

/** Только Мастер игры. */
function requireMaster(payload) {
  if (payload.role !== 'master') {
    throw new ApiError(403, 'FORBIDDEN_ROLE', 'Действие доступно только Мастеру игры')
  }
  return payload
}

/** Внутренние роуты бота: заголовок X-Bot-Secret должен совпадать с BOT_SECRET_KEY. */
function requireBotSecret(event) {
  const expected = process.env.BOT_SECRET_KEY
  if (!expected) {
    throw new ApiError(500, 'CONFIG_ERROR', 'Не задана переменная окружения BOT_SECRET_KEY')
  }
  const provided = asTrimmedString(getHeader(event, BOT_SECRET_HEADER))
  if (!provided || provided !== expected) {
    throw new ApiError(401, 'INVALID_BOT_SECRET', 'Неверный или отсутствующий заголовок X-Bot-Secret')
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

// ─── Обработчики приключений и бота ──────────────────────────────────────────

/** POST /adventures/draft — черновик приключения (только Мастер). */
async function handleCreateAdventureDraft(event, body) {
  const payload = requireMaster(authenticate(event))
  const draft = buildAdventureDraft(body)

  await ensureSchema()

  const created = await withSession(async (session) => {
    const master = await requireUserRow(session, payload.id)

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const syncCode = generateSyncCode()
      const existing = await findAdventureBySyncCode(session, syncCode)
      if (existing) {
        continue
      }

      const now = new Date()
      const adventure = {
        ...draft,
        id: uuidv4(),
        master_id: payload.id,
        master_name: master.name,
        status: 'draft',
        sync_code: syncCode,
        current_players: 0,
        created_at: now,
        updated_at: now,
      }

      try {
        await insertAdventure(session, adventure)
        return { id: adventure.id, syncCode }
      } catch (error) {
        if (!isConflictError(error)) {
          throw error
        }
        console.warn(`WARN: код ${syncCode} уже занят, генерируем новый`)
      }
    }

    throw new ApiError(500, 'SYNC_CODE_CONFLICT', 'Не удалось сгенерировать свободный код синхронизации')
  })

  return json(200, { success: true, adventure_id: created.id, sync_code: created.syncCode })
}

/** GET /adventures/draft-status?adventure_id=… — статус привязки Telegram-группы (Мастер). */
async function handleAdventureDraftStatus(event) {
  const payload = requireMaster(authenticate(event))
  const adventureId = asTrimmedString(getQueryParam(event, 'adventure_id'))
  if (!adventureId) {
    throw validationError('Укажите query-параметр adventure_id')
  }

  await ensureSchema()

  const adventure = await withSession((session) => findAdventureById(session, adventureId))
  if (!adventure || adventure.master_id !== payload.id) {
    throw new ApiError(404, 'ADVENTURE_NOT_FOUND', 'Приключение не найдено')
  }

  return json(200, {
    status: adventure.status,
    tg_group_id: adventure.tg_group_id ?? null,
    tg_invite_link: adventure.tg_invite_link ?? null,
  })
}

/** POST /bot/sync — бот привязывает Telegram-группу к приключению. */
async function handleBotSync(event, body) {
  requireBotSecret(event)

  const syncCode = asTrimmedString(body.sync_code).toUpperCase()
  const tgGroupId = optionalText(body.tg_group_id, 64)
  const tgInviteLink = optionalText(body.tg_invite_link, 512)
  if (!syncCode) {
    throw validationError('Укажите sync_code')
  }
  if (!tgGroupId) {
    throw validationError('Укажите tg_group_id')
  }

  await ensureSchema()

  const adventure = await withSession(async (session) => {
    const found = await findAdventureBySyncCode(session, syncCode)
    if (!found) {
      throw new ApiError(404, 'ADVENTURE_NOT_FOUND', `Приключение с кодом ${syncCode} не найдено`)
    }

    // Группа не должна обслуживать два активных приключения одновременно.
    const boundAdventure = await findAdventureByTgGroupId(session, tgGroupId)
    if (boundAdventure && boundAdventure.id !== found.id) {
      throw new ApiError(409, 'GROUP_ALREADY_BOUND', 'Эта группа уже привязана к активному приключению')
    }

    await updateAdventure(session, found.id, {
      tg_group_id: tgGroupId,
      tg_invite_link: tgInviteLink,
      status: 'synced',
      updated_at: new Date(),
    })
    return found
  })

  return json(200, { success: true, adventure_title: adventure.title })
}

/** POST /bot/member-update — бот сообщает о входе/выходе игрока. */
async function handleBotMemberUpdate(event, body) {
  requireBotSecret(event)

  const tgGroupId = optionalText(body.tg_group_id, 64)
  const action = asTrimmedString(body.action).toLowerCase()
  if (!tgGroupId) {
    throw validationError('Укажите tg_group_id')
  }
  if (action !== 'joined' && action !== 'left') {
    throw validationError('action должен быть joined или left')
  }

  await ensureSchema()

  const result = await withSession(async (session) => {
    const adventure = await findAdventureByTgGroupId(session, tgGroupId)
    if (!adventure) {
      throw new ApiError(404, 'ADVENTURE_NOT_FOUND', 'Приключение для этой группы не найдено')
    }

    const delta = action === 'joined' ? 1 : -1
    const currentPlayers = clampPlayers(Number(adventure.current_players ?? 0) + delta, adventure.max_players)
    await updateAdventure(session, adventure.id, { current_players: currentPlayers, updated_at: new Date() })

    return {
      current_players: currentPlayers,
      max_players: adventure.max_players ?? null,
      title: adventure.title,
    }
  })

  return json(200, result)
}

/** POST /adventures/publish — публикация афиши (только Мастер). */
async function handlePublishAdventure(event, body) {
  const payload = requireMaster(authenticate(event))

  const adventureId = asTrimmedString(body.adventure_id)
  if (!adventureId) {
    throw validationError('Укажите adventure_id')
  }

  await ensureSchema()

  const adventure = await withSession(async (session) => {
    const existing = await findAdventureById(session, adventureId)
    if (!existing || existing.master_id !== payload.id) {
      throw new ApiError(404, 'ADVENTURE_NOT_FOUND', 'Приключение не найдено')
    }

    await updateAdventure(session, existing.id, {
      status: 'active',
      poster_url: optionalText(body.poster_url, 512),
      logo_url: optionalText(body.logo_url, 512),
      logo_position_json: optionalJsonText(body.logo_position_json),
      updated_at: new Date(),
    })

    return findAdventureById(session, existing.id)
  })

  return json(200, { success: true, adventure: toPublicAdventure(adventure) })
}

/** GET /adventures — публичная афиша (только активные, по дате игры). */
async function handleListAdventures() {
  await ensureSchema()

  const rows = await withSession((session) => listActiveAdventures(session))
  return json(200, { adventures: rows.map(toPublicAdventure) })
}

// ─── Разбор HTTP-запроса и роутинг ───────────────────────────────────────────

function resolveMethod(event) {
  const raw = event.httpMethod || (event.requestContext && event.requestContext.http && event.requestContext.http.method)
  return String(raw || 'GET').toUpperCase()
}

function getQueryParam(event, name) {
  const params = event.queryStringParameters
  if (!params) {
    return undefined
  }
  const key = Object.keys(params).find((param) => param.toLowerCase() === name.toLowerCase())
  return key ? params[key] : undefined
}

function safeDecode(value) {
  if (!value.includes('%')) {
    return value
  }
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * Определяет маршрут запроса. Источники (по приоритету):
 * 1. заголовок `X-Route`;
 * 2. query-параметр `?route=/ping` — нужен при прямом вызове функции;
 * 3. обычный путь запроса (работает за API Gateway).
 */
function resolvePath(event) {
  const routeFromHeader = asTrimmedString(getHeader(event, 'x-route'))
  const routeFromQuery = asTrimmedString(getQueryParam(event, ROUTE_QUERY_PARAM))
  const explicitRoute = safeDecode(routeFromHeader || routeFromQuery)

  let path = explicitRoute
  if (!path) {
    const raw =
      event.path || event.url || (event.requestContext && event.requestContext.http && event.requestContext.http.path) || '/'
    path = String(raw).split('?')[0]
  }

  if (PATH_PREFIX && path.startsWith(PATH_PREFIX)) {
    path = path.slice(PATH_PREFIX.length)
  }
  if (!path.startsWith('/')) {
    path = `/${path}`
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

    if (path === '/adventures') {
      return await handleListAdventures()
    }
    if (path === '/adventures/draft') {
      return await handleCreateAdventureDraft(event, parseBody(event))
    }
    if (path === '/adventures/draft-status') {
      return await handleAdventureDraftStatus(event)
    }
    if (path === '/adventures/publish') {
      return await handlePublishAdventure(event, parseBody(event))
    }
    if (path === '/bot/sync') {
      return await handleBotSync(event, parseBody(event))
    }
    if (path === '/bot/member-update') {
      return await handleBotMemberUpdate(event, parseBody(event))
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



