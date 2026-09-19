/**
 * Тесты HTTP-обработчика на подменённой сессии YDB (реальная база не нужна).
 *
 * Проверяются статусы роутов, сгенерированный YQL и типы параметров.
 * Запуск: `npm test` в папке backend.
 */
process.env.JWT_SECRET = 'test-secret'
process.env.BOT_SECRET_KEY = 'bot-secret-key'
process.env.MASTER_INVITE_CODE = 'DUNGEON-MASTER'
process.env.YDB_ENDPOINT = 'grpc://localhost:2136'
process.env.YDB_DATABASE = '/local'

import ydbSdk from 'ydb-sdk'
import jwt from 'jsonwebtoken'

const { Types } = ydbSdk

const USER_ID = '854ecd04-79b9-42f7-996a-111111111111'
const ADVENTURE_ID = '11111111-2222-3333-4444-555555555555'
const BOT_SECRET_HEADER = 'X-Bot-Secret'

// ─── Фейковая YDB ────────────────────────────────────────────────────────────

const queries = []
const db = {
  user: {
    id: USER_ID,
    email: 'master@example.com',
    name: 'Мастер Гром',
    role: 'master',
    gender: 'male',
    birth_date: '1990-01-01',
    telegram_username: 'grom',
  },
  adventureRows: [],
}

const USER_SCHEMA = [
  ['id', Types.UTF8],
  ['email', Types.UTF8],
  ['name', Types.UTF8],
  ['role', Types.UTF8],
  ['gender', Types.optional(Types.UTF8)],
  ['birth_date', Types.optional(Types.UTF8)],
  ['telegram_username', Types.optional(Types.UTF8)],
]

// Схема намеренно «широкая»: Bool/Uint32/Utf8? — проверяем адаптацию типов.
const ADVENTURE_SCHEMA = [
  ['id', Types.UTF8],
  ['master_id', Types.UTF8],
  ['master_name', Types.UTF8],
  ['title', Types.UTF8],
  ['description', Types.optional(Types.UTF8)],
  ['system', Types.optional(Types.UTF8)],
  ['is_online', Types.optional(Types.BOOL)],
  ['player_level', Types.optional(Types.UTF8)],
  ['game_date', Types.optional(Types.UTF8)],
  ['game_time', Types.optional(Types.UTF8)],
  ['duration_hours', Types.optional(Types.UINT32)],
  ['location', Types.optional(Types.UTF8)],
  ['price', Types.optional(Types.UTF8)],
  ['min_players', Types.optional(Types.UINT32)],
  ['max_players', Types.optional(Types.UINT32)],
  ['current_players', Types.UINT32],
  ['additional_notes', Types.optional(Types.UTF8)],
  ['status', Types.UTF8],
  ['sync_code', Types.UTF8],
  ['tg_group_id', Types.optional(Types.UTF8)],
  ['tg_invite_link', Types.optional(Types.UTF8)],
  ['poster_url', Types.optional(Types.UTF8)],
  ['logo_url', Types.optional(Types.UTF8)],
  ['logo_position_json', Types.optional(Types.UTF8)],
]

function baseTypeId(type) {
  if (!type) return null
  if (typeof type.typeId === 'number') return type.typeId
  if (type.optionalType && type.optionalType.item) return baseTypeId(type.optionalType.item)
  return null
}

function encodeFakeValue(type, value) {
  if (value === null || value === undefined) return { nullFlagValue: 0 }
  switch (baseTypeId(type)) {
    case Types.BOOL.typeId:
      return { boolValue: Boolean(value) }
    case Types.UINT32.typeId:
      return { uint32Value: Number(value) }
    default:
      return { textValue: String(value) }
  }
}

function buildResultSet(rows, schema) {
  return {
    columns: schema.map(([name, type]) => ({ name, type })),
    rows: rows.map((row) => ({ items: schema.map(([, type], index) => encodeFakeValue(type, row[schema[index][0]])) })),
  }
}

function selectResultSet(yql, params) {
  if (!/FROM adventures/i.test(yql)) {
    return [buildResultSet([db.user], USER_SCHEMA)]
  }

  const textParam = (name) => {
    const value = params && params[name]
    return value && value.value ? value.value.textValue : undefined
  }

  let matched = db.adventureRows
  if (params && params.$id) {
    matched = matched.filter((row) => row.id === textParam('$id'))
  } else if (params && params.$sync_code) {
    matched = matched.filter((row) => row.sync_code === textParam('$sync_code'))
  } else if (params && params.$tg_group_id) {
    matched = matched.filter((row) => row.tg_group_id === textParam('$tg_group_id'))
  } else if (params && params.$status) {
    matched = matched.filter((row) => row.status === textParam('$status'))
  }

  return matched.length ? [buildResultSet(matched, ADVENTURE_SCHEMA)] : []
}

function createFakeSession() {
  return {
    async describeTable(tablePath) {
      if (tablePath === 'adventures') {
        return {
          columns: ADVENTURE_SCHEMA.map(([name, type]) => ({ name, type })),
          indexes: [{ name: 'idx_adventures_sync_code' }],
        }
      }
      return { columns: USER_SCHEMA.map(([name, type]) => ({ name, type })), indexes: [{ name: 'idx_users_email' }] }
    },
    async createTable() {},
    async executeQuery(yql, params) {
      queries.push({ yql, params })
      if (/\bSELECT\b/i.test(yql)) {
        return { resultSets: selectResultSet(yql, params) }
      }
      return { resultSets: [] }
    },
  }
}

// Драйвер и клиент YDB подменяем до первого обращения (драйвер создаётся лениво).
ydbSdk.Driver.prototype.ready = async () => true
const probeDriver = new ydbSdk.Driver({
  endpoint: 'grpc://localhost:2136',
  database: '/local',
  authService: new ydbSdk.AnonymousAuthService(),
})
Object.getPrototypeOf(probeDriver.tableClient).withSession = async (fn) => fn(createFakeSession())

const { handler } = await import('../index.js')

// ─── Хелперы тестов ─────────────────────────────────────────────────────────

const context = { requestId: 'test' }
const results = []

function check(label, condition, extra = '') {
  results.push({ label, ok: Boolean(condition) })
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}${extra ? ' | ' + extra : ''}`)
}

function tokenFor(role = 'master', id = USER_ID) {
  return jwt.sign({ id, email: 'master@example.com', role }, 'test-secret', { expiresIn: '1h' })
}

function call(method, path, { body, headers = {}, queryParams, isBase64Encoded } = {}) {
  return handler(
    {
      httpMethod: method,
      path: '/',
      queryStringParameters: { route: path, ...(queryParams || {}) },
      headers,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      isBase64Encoded,
    },
    context,
  )
}

function lastQuery(pattern) {
  return [...queries].reverse().find((query) => pattern.test(query.yql)) || { yql: '', params: {} }
}

// ─── Тесты: афиша и черновик ────────────────────────────────────────────────

const masterHeaders = { 'X-Auth-Token': tokenFor('master') }
const playerHeaders = { 'X-Auth-Token': tokenFor('player') }
const botHeaders = { [BOT_SECRET_HEADER]: 'bot-secret-key' }

let response = await call('GET', '/adventures')
check('GET /adventures (пусто) -> 200', response.statusCode === 200, `status=${response.statusCode}`)
check('GET /adventures отдаёт массив', JSON.parse(response.body).adventures.length === 0)

db.adventureRows = [
  { id: 'a1', title: 'Тени Пединбурга', status: 'active', current_players: 3, max_players: 5, game_date: '2026-10-01' },
  { id: 'a2', title: 'Кубок Багрового Лиса', status: 'active', current_players: 1, max_players: 4, game_date: '2026-10-05' },
  { id: 'a3', title: 'Черновик', status: 'draft', game_date: '2026-09-01' },
]
queries.length = 0
response = await call('GET', '/adventures')
const list = JSON.parse(response.body).adventures
check('GET /adventures -> 200 со списком', response.statusCode === 200 && list.length === 2, `count=${list.length}`)
check('Афиша: порядок и поля', list[0].title === 'Тени Пединбурга' && list[1].game_date === '2026-10-05')
const listQuery = lastQuery(/FROM adventures/i)
check(
  'Афиша: фильтр status=active + сортировка',
  /WHERE status = \$status/i.test(listQuery.yql) && /ORDER BY game_date, game_time/i.test(listQuery.yql),
)
db.adventureRows = []

response = await call('POST', '/adventures/draft', { headers: playerHeaders, body: { title: 'Тест' } })
check('POST /adventures/draft игроком -> 403', response.statusCode === 403, `status=${response.statusCode}`)

response = await call('POST', '/adventures/draft', { headers: masterHeaders, body: { description: 'без названия' } })
check('POST /adventures/draft без title -> 400', response.statusCode === 400)

response = await call('POST', '/adventures/draft', { headers: masterHeaders, body: { title: 'Тест', min_players: 6, max_players: 3 } })
check('POST /adventures/draft min>max -> 400', response.statusCode === 400)

queries.length = 0
response = await call('POST', '/adventures/draft', {
  headers: masterHeaders,
  body: {
    title: 'Тени Пединбурга',
    description: 'Городской детектив',
    system: 'D&D 5e',
    is_online: true,
    player_level: '3-5',
    game_date: '2026-10-01',
    game_time: '19:00',
    duration_hours: 4,
    location: 'Бар «Подземелье»',
    price: 500,
    min_players: 3,
    max_players: 6,
    additional_notes: 'Взять кубики',
  },
})
const draft = JSON.parse(response.body)
check('POST /adventures/draft -> 200', response.statusCode === 200, `status=${response.statusCode} body=${response.body.slice(0, 110)}`)
check('Код синхронизации формата PEDIN-XXXX', /^PEDIN-[A-Z0-9]{4}$/.test(draft.sync_code || ''), `sync_code=${draft.sync_code}`)
check(
  'Ответ: success + adventure_id (uuid)',
  draft.success === true && typeof draft.adventure_id === 'string' && draft.adventure_id.length === 36,
)

const insert = lastQuery(/INSERT INTO adventures/i)
const insertColumns = (insert.yql.match(/INSERT INTO adventures \(([^)]+)\)/) || [])[1] || ''
check(
  'INSERT содержит обязательные колонки',
  ['id', 'master_id', 'master_name', 'status', 'sync_code', 'current_players'].every((column) => insertColumns.includes(column)),
  insertColumns,
)
check('INSERT: status = draft, sync_code передан', insert.params.$status.value.textValue === 'draft' && Boolean(insert.params.$sync_code.value.textValue))
check(
  'INSERT: master_id из токена, master_name из БД',
  insert.params.$master_id.value.textValue === USER_ID && insert.params.$master_name.value.textValue === 'Мастер Гром',
)
check(
  'INSERT: current_players = 0 (Uint32)',
  insert.params.$current_players.value.uint32Value === 0 && insert.params.$current_players.type.typeId === Types.UINT32.typeId,
)
check(
  'INSERT: is_online = true (Bool)',
  insert.params.$is_online.value.boolValue === true && insert.params.$is_online.type.typeId === Types.BOOL.typeId,
)
check('INSERT: duration_hours = 4 (Uint32)', insert.params.$duration_hours.value.uint32Value === 4)
check(
  'INSERT: строковые колонки объявлены как Utf8',
  /DECLARE \$title AS Utf8;/.test(insert.yql) && /DECLARE \$sync_code AS Utf8;/.test(insert.yql),
  insert.yql.replace(/\s+/g, ' ').slice(0, 160),
)
check('INSERT: числовой price приведён к строке', insert.params.$price.value.textValue === '500')
check(
  'INSERT: created_at/updated_at — Timestamp',
  insert.params.$created_at.type.typeId === Types.TIMESTAMP.typeId && insert.params.$updated_at.type.typeId === Types.TIMESTAMP.typeId,
)

// ─── Тесты: статус черновика и публикация ───────────────────────────────────

db.adventureRows = [
  {
    id: ADVENTURE_ID,
    master_id: USER_ID,
    status: 'synced',
    title: 'Тени Пединбурга',
    tg_group_id: '-100500',
    tg_invite_link: 'https://t.me/+abc',
    sync_code: 'PEDIN-4819',
  },
]

response = await call('GET', '/adventures/draft-status', { headers: masterHeaders, queryParams: { adventure_id: ADVENTURE_ID } })
const draftStatus = JSON.parse(response.body)
check('GET /adventures/draft-status -> 200', response.statusCode === 200, `status=${response.statusCode} body=${response.body.slice(0, 110)}`)
check(
  'draft-status отдаёт status/tg_group_id/tg_invite_link',
  draftStatus.status === 'synced' && draftStatus.tg_group_id === '-100500' && draftStatus.tg_invite_link === 'https://t.me/+abc',
  JSON.stringify(draftStatus),
)
check('draft-status: adventure_id приходит из query', queries.some((query) => query.params && query.params.$id && query.params.$id.value.textValue === ADVENTURE_ID))

response = await call('GET', '/adventures/draft-status', { headers: masterHeaders })
check('draft-status без adventure_id -> 400', response.statusCode === 400)

response = await call('GET', '/adventures/draft-status', { headers: masterHeaders, queryParams: { adventure_id: 'чужое' } })
check('draft-status несуществующего -> 404', response.statusCode === 404)

response = await call('GET', '/adventures/draft-status', { headers: playerHeaders, queryParams: { adventure_id: ADVENTURE_ID } })
check('draft-status игроком -> 403', response.statusCode === 403)

db.adventureRows = [
  { id: ADVENTURE_ID, master_id: USER_ID, status: 'synced', title: 'Тени Пединбурга', current_players: 1, max_players: 5 },
]
queries.length = 0
response = await call('POST', '/adventures/publish', {
  headers: masterHeaders,
  body: {
    adventure_id: ADVENTURE_ID,
    poster_url: 'https://cdn.example/poster.png',
    logo_url: 'https://cdn.example/logo.png',
    logo_position_json: { x: 12, y: 34 },
  },
})
const publish = JSON.parse(response.body)
check('POST /adventures/publish -> 200', response.statusCode === 200, `status=${response.statusCode} body=${response.body.slice(0, 110)}`)
check('publish возвращает adventure', publish.success === true && publish.adventure && publish.adventure.title === 'Тени Пединбурга')

const publishUpdate = lastQuery(/UPDATE adventures/i)
check(
  'publish: status -> active + постеры',
  publishUpdate.params.$status.value.textValue === 'active' &&
    publishUpdate.params.$poster_url.value.textValue === 'https://cdn.example/poster.png',
)
check('publish: logo_position_json сериализуется в строку', publishUpdate.params.$logo_position_json.value.textValue === '{"x":12,"y":34}')

response = await call('POST', '/adventures/publish', { headers: playerHeaders, body: { adventure_id: ADVENTURE_ID } })
check('publish игроком -> 403', response.statusCode === 403)

response = await call('POST', '/adventures/publish', { headers: masterHeaders, body: {} })
check('publish без adventure_id -> 400', response.statusCode === 400)

// ─── Тесты: роуты Telegram-бота ─────────────────────────────────────────────

db.adventureRows = [{ id: ADVENTURE_ID, master_id: USER_ID, status: 'draft', sync_code: 'PEDIN-4819', title: 'Тени Пединбурга' }]

response = await call('POST', '/bot/sync', { body: { sync_code: 'PEDIN-4819', tg_group_id: '-100500' } })
check('POST /bot/sync без X-Bot-Secret -> 401', response.statusCode === 401, `status=${response.statusCode}`)

response = await call('POST', '/bot/sync', { headers: { [BOT_SECRET_HEADER]: 'wrong' }, body: { sync_code: 'PEDIN-4819', tg_group_id: '-100500' } })
check('POST /bot/sync с неверным секретом -> 401', response.statusCode === 401)

queries.length = 0
response = await call('POST', '/bot/sync', {
  headers: botHeaders,
  body: { sync_code: 'pedin-4819', tg_group_id: '-100500', tg_invite_link: 'https://t.me/+abc' },
})
const sync = JSON.parse(response.body)
check('POST /bot/sync -> 200', response.statusCode === 200, `status=${response.statusCode} body=${response.body.slice(0, 110)}`)
check('bot/sync возвращает adventure_title', sync.success === true && sync.adventure_title === 'Тени Пединбурга', JSON.stringify(sync))

const syncSelect = queries.find((query) => /SELECT/i.test(query.yql) && /adventures/i.test(query.yql)) || { yql: '' }
check('bot/sync: поиск по индексу idx_adventures_sync_code', /VIEW idx_adventures_sync_code/.test(syncSelect.yql))
check('bot/sync: код приведён к верхнему регистру', Boolean(syncSelect.params && syncSelect.params.$sync_code.value.textValue === 'PEDIN-4819'))

const syncUpdate = lastQuery(/UPDATE adventures/i)
check(
  'bot/sync: status -> synced + tg_group_id/tg_invite_link',
  syncUpdate.params.$status.value.textValue === 'synced' &&
    syncUpdate.params.$tg_group_id.value.textValue === '-100500' &&
    syncUpdate.params.$tg_invite_link.value.textValue === 'https://t.me/+abc',
)

response = await call('POST', '/bot/sync', { headers: botHeaders, body: { sync_code: 'PEDIN-0000', tg_group_id: '-1' } })
check('bot/sync неизвестный код -> 404', response.statusCode === 404)

// Группа уже занята другим активным приключением → 409
db.adventureRows = [
  { id: ADVENTURE_ID, master_id: USER_ID, status: 'draft', sync_code: 'PEDIN-4819', title: 'Тени Пединбурга' },
  { id: 'other-adventure', status: 'active', tg_group_id: '-100500', title: 'Чужое приключение' },
]
response = await call('POST', '/bot/sync', {
  headers: botHeaders,
  body: { sync_code: 'PEDIN-4819', tg_group_id: '-100500' },
})
const groupConflict = JSON.parse(response.body)
check(
  'bot/sync: группа занята другим приключением -> 409',
  response.statusCode === 409 && groupConflict.error === 'GROUP_ALREADY_BOUND',
  `status=${response.statusCode} body=${response.body.slice(0, 110)}`,
)

// Повторная привязка той же группы к тому же приключению разрешена
db.adventureRows = [
  {
    id: ADVENTURE_ID,
    master_id: USER_ID,
    status: 'synced',
    sync_code: 'PEDIN-4819',
    title: 'Тени Пединбурга',
    tg_group_id: '-100500',
  },
]
response = await call('POST', '/bot/sync', {
  headers: botHeaders,
  body: { sync_code: 'PEDIN-4819', tg_group_id: '-100500' },
})
check('bot/sync: повторная привязка того же приключения -> 200', response.statusCode === 200, `status=${response.statusCode}`)

// member-update: joined ограничивается max_players
db.adventureRows = [
  { id: ADVENTURE_ID, status: 'synced', tg_group_id: '-100500', title: 'Тени Пединбурга', current_players: 2, max_players: 3 },
]
queries.length = 0
response = await call('POST', '/bot/member-update', { headers: botHeaders, body: { tg_group_id: '-100500', action: 'joined' } })
const joined = JSON.parse(response.body)
check(
  'bot/member-update joined: current_players не выше max',
  response.statusCode === 200 && joined.current_players === 3 && joined.max_players === 3,
  response.body.slice(0, 110),
)
check('bot/member-update: title в ответе', joined.title === 'Тени Пединбурга')
check(
  'bot/member-update: UPDATE current_players (Uint32)',
  lastQuery(/UPDATE adventures/i).params.$current_players.value.uint32Value === 3,
)

// member-update: left не уходит ниже нуля
db.adventureRows = [
  { id: ADVENTURE_ID, status: 'active', tg_group_id: '-100500', title: 'Тени Пединбурга', current_players: 0, max_players: 3 },
]
response = await call('POST', '/bot/member-update', { headers: botHeaders, body: { tg_group_id: '-100500', action: 'left' } })
check('bot/member-update left: current_players не ниже 0', response.statusCode === 200 && JSON.parse(response.body).current_players === 0)

response = await call('POST', '/bot/member-update', { headers: botHeaders, body: { tg_group_id: '-100500', action: 'flew' } })
check('bot/member-update неверный action -> 400', response.statusCode === 400)

db.adventureRows = []
response = await call('POST', '/bot/member-update', { headers: botHeaders, body: { tg_group_id: '-999', action: 'joined' } })
check('bot/member-update без приключения -> 404', response.statusCode === 404)

// ─── Регрессия: профиль пользователя ────────────────────────────────────────

response = await call('PUT', '/auth/me', { headers: masterHeaders, body: { name: 'Новое имя', telegram_username: null, gender: null } })
check('PUT /auth/me -> 200', response.statusCode === 200, `status=${response.statusCode}`)

response = await call('DELETE', '/auth/me', { headers: masterHeaders })
check('DELETE /auth/me (без body) -> 200', response.statusCode === 200 && JSON.parse(response.body).success === true)

// ─── Итог ───────────────────────────────────────────────────────────────────

const failed = results.filter((result) => !result.ok)
console.log(`\nИтого пройдено: ${results.length - failed.length}/${results.length}`)
if (failed.length) {
  console.log('Провалились:', failed.map((result) => result.label).join('; '))
}
process.exit(failed.length === 0 ? 0 : 1)
