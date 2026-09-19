# Backend — «Подземелья Пединбурга»

Serverless API для **Yandex Cloud Functions** (runtime `nodejs22`) с базой данных **YDB**.

Весь бэкенд — один файл `index.js` с единым HTTP-обработчиком (`export const handler`):

- полная поддержка CORS, включая немедленный ответ `200 OK` на `OPTIONS`-preflight;
- авторизация по JWT (срок жизни 30 дней), пароли хешируются через `bcryptjs`;
- таблица `users` и индекс `idx_users_email` создаются автоматически (миграция идемпотентна
  и выполняется один раз на инстанс функции);
- `body` корректно разбирается и в обычном, и в base64-виде (`event.isBase64Encoded`).

## Структура

```
backend/
  index.js       # обработчик: роутинг, валидация, запросы к YDB
  package.json   # "type": "module", зависимости функции
  README.md      # этот файл
```

## Зависимости

| Пакет | Зачем нужен |
|---|---|
| `ydb-sdk` | драйвер YDB: создание схемы и выполнение YQL-запросов |
| `@yandex-cloud/nodejs-sdk` | **peer-зависимость** `ydb-sdk`: `MetadataAuthService` берёт из неё IAM-токен сервисного аккаунта |
| `jsonwebtoken` | подпись и проверка JWT |
| `bcryptjs` | хеширование и проверка паролей |
| `uuid` | первичный ключ пользователя |

## Переменные окружения

| Переменная | Обяз. | Описание |
|---|---|---|
| `YDB_ENDPOINT` | да | `grpc://docapi.serverless.yandexcloud.net:2135` |
| `YDB_DATABASE` | да | `/ru-central1/<folder-id>/<database-id>` |
| `JWT_SECRET` | да | секрет подписи JWT |
| `MASTER_INVITE_CODE` | нет | если `master_code` совпадает — регистрация даёт `role: "master"`, иначе `role: "player"` |
| `JWT_EXPIRES_IN` | нет | срок жизни токена, по умолчанию `30d` |
| `API_PATH_PREFIX` | нет | префикс пути из API Gateway, например `/api` |
| `YDB_AUTO_MIGRATE` | нет | `false` — отключить автоматическую миграцию схемы |

## Схема данных

Миграция (один раз на инстанс функции) создаёт таблицу и индекс:

```sql
CREATE TABLE users (
  id                Uuid,
  email             Utf8,
  password_hash     Utf8,
  name              Utf8,
  role              Utf8,
  gender            Utf8?,
  birth_date        Utf8?,
  telegram_username Utf8?,
  avatar_url        Utf8?,
  created_at        Timestamp,
  updated_at        Timestamp,
  PRIMARY KEY (id),
  INDEX idx_users_email GLOBAL UNIQUE ON (email)
);
```

- `role` — `player` | `master`;
- `gender` — `male` | `female` | `other`;
- `birth_date` — строка `YYYY-MM-DD`;
- уникальность email обеспечивается глобальным уникальным индексом;
- поиск пользователя при регистрации/логине идёт через индекс:
  `SELECT ... FROM users VIEW idx_users_email WHERE email = $email`.

Если таблица уже есть, а индекса нет — он будет создан при следующем запросе
(проверка через `describeTable`). Отключить автоматизацию: `YDB_AUTO_MIGRATE=false`.

## Формат ответов

Успех — данные в теле ответа. Ошибка — всегда один и тот же формат:

```json
{ "error": "VALIDATION_ERROR", "message": "Пароль должен содержать минимум 6 символов" }
```

Публичный профиль пользователя (`user`) во всех ответах выглядит так:

```json
{
  "id": "0f1c7d5e-9b6a-4f1d-9f4a-2b1f0a6c9d33",
  "email": "player@example.com",
  "name": "Гром",
  "role": "player",
  "gender": "male",
  "birth_date": "1995-04-12",
  "telegram_username": "grom",
  "avatar_url": null,
  "created_at": "2026-09-19T09:12:31.004Z",
  "updated_at": "2026-09-19T09:12:31.004Z"
}
```

`password_hash` наружу не отдаётся никогда.

## API

### GET /ping

Проверка живости, к YDB не обращается.

```bash
curl https://<api-host>/ping
```

```json
{ "status": "ok", "time": 1789810668715 }
```

### POST /auth/register

```bash
curl -X POST https://<api-host>/auth/register \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "player@example.com",
    "password": "secret123",
    "name": "Гром",
    "master_code": "DUNGEON-MASTER",
    "gender": "male",
    "birth_date": "1995-04-12",
    "telegram_username": "@grom"
  }'
```

- `email` — обязателен, проверяется формат, приводится к нижнему регистру;
- `password` — обязателен, минимум 6 символов;
- `name` — обязателен, до 64 символов;
- `master_code` — при совпадении с `MASTER_INVITE_CODE` роль становится `master`, иначе `player`;
- `gender`, `birth_date`, `telegram_username` — необязательны (в telegram `@` отбрасывается).

Ответ `201 Created`: `{ "token": "<jwt>", "user": { ... } }`. Занятый email → `409 EMAIL_ALREADY_EXISTS`.

### POST /auth/login

```bash
curl -X POST https://<api-host>/auth/login \
  -H 'Content-Type: application/json' \
  -d '{ "email": "player@example.com", "password": "secret123" }'
```

Ответ `200 OK`: `{ "token": "<jwt>", "user": { ... } }`. Неверная пара → `401 INVALID_CREDENTIALS`.

### GET /auth/me

```bash
curl https://<api-host>/auth/me -H "Authorization: Bearer $TOKEN"
```

Ответ `200 OK`: `{ "user": { ... } }`.

### PUT /auth/me

Обновляет только переданные поля: `name`, `gender`, `birth_date`, `telegram_username`, `avatar_url`
(принимается и короткий ключ `avatar`). Чтобы очистить поле — передайте `null` или пустую строку.

```bash
curl -X PUT https://<api-host>/auth/me \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{ "name": "Гром Скала", "telegram_username": "grom_skala" }'
```

Ответ `200 OK`: `{ "user": { ... } }` — обновлённый профиль.

### DELETE /auth/me

Удаляет пользователя из YDB безвозвратно.

```bash
curl -X DELETE https://<api-host>/auth/me -H "Authorization: Bearer $TOKEN"
```

Ответ `200 OK`: `{ "success": true }`.

## Коды ошибок

| `error` | HTTP | Когда возникает |
|---|---|---|
| `VALIDATION_ERROR` | 400 | некорректные поля запроса |
| `INVALID_JSON` | 400 | тело запроса не является JSON |
| `UNAUTHORIZED` | 401 | отсутствует заголовок `Authorization: Bearer <token>` |
| `INVALID_TOKEN` | 401 | подпись или срок жизни JWT не прошли проверку |
| `INVALID_CREDENTIALS` | 401 | неверный email или пароль |
| `NOT_FOUND` | 404 | неизвестный роут |
| `USER_NOT_FOUND` | 404 | пользователь из токена уже удалён |
| `METHOD_NOT_ALLOWED` | 405 | метод не поддерживается для роута (в ответе есть заголовок `Allow`) |
| `EMAIL_ALREADY_EXISTS` | 409 | email уже занят |
| `CONFIG_ERROR` | 500 | не заданы `JWT_SECRET`, `YDB_ENDPOINT` или `YDB_DATABASE` |
| `INTERNAL_ERROR` | 500 | непредвиденная ошибка (детали — в логах функции) |
| `YDB_NOT_READY` | 503 | драйвер не смог подключиться к YDB за 10 секунд |

## Деплой в Yandex Cloud

```bash
cd backend
npm ci

yc serverless function create --name dungeons-api

yc serverless function version create \
  --function-name dungeons-api \
  --runtime nodejs22 \
  --entrypoint index.handler \
  --memory 256m \
  --execution-timeout 30s \
  --source-path . \
  --service-account-id <sa-id> \
  --environment YDB_ENDPOINT=grpc://docapi.serverless.yandexcloud.net:2135 \
  --environment YDB_DATABASE=/ru-central1/<folder-id>/<database-id> \
  --environment JWT_SECRET=<секрет> \
  --environment MASTER_INVITE_CODE=<код-мастера>
```

- сервисному аккаунту нужны права на БД (`ydb.editor`) — `MetadataAuthService` берёт его IAM-токен;
- фронтенд обращается к функции через API Gateway (CORS уже отдаёт сам обработчик).
  Если gateway публикует функцию под префиксом (например `/api`), задайте `API_PATH_PREFIX=/api`;
- локальная сборка архива (PowerShell): `Compress-Archive -Path * -DestinationPath function.zip -Force`.

## Локальная проверка

```bash
cd backend
npm install
node --check index.js
```

Смоук-тест без реальной БД: задайте `process.env.JWT_SECRET` и вызывайте
`handler({ httpMethod, path, headers, body })` — ветки `OPTIONS`, `/ping`, валидация и `401`
работают без подключения к YDB (для остальных запросов понадобятся `YDB_ENDPOINT`/`YDB_DATABASE`).

## Особенности реализации

- **Импорт SDK.** `ydb-sdk@5.x` поставляется как CommonJS (файлы в `build/esm` тоже содержат CJS),
  поэтому `Driver` недоступен как named-export в ESM: используется `import ydbSdk from 'ydb-sdk'`
  с последующей деструктуризацией.
- **Соединение.** Драйвер создаётся лениво и хранится в модуле — между «тёплыми» вызовами функции
  соединение переиспользуется; перед каждой сессией вызывается `driver.ready(10000)`.
- **Имена колонок.** SDK по умолчанию не переименовывает поля (`identity`-конвертация), поэтому API
  отдаёт те же `snake_case`-ключи, что и принимает.
- **Атомарность.** Регистрация делает `INSERT` (а не `UPSERT`): при гонке запросов уникальный индекс
  не позволит создать второй профиль с тем же email.

