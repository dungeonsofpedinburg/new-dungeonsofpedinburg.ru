# Подземелья Пединбурга

Приложение для настольных ролевых игр в барах. Mobile-first интерфейс, тёмная тема по умолчанию.

## Стек

- **React 19 + TypeScript** — сборка на **Vite 8**
- **Tailwind CSS v4** — через плагин `@tailwindcss/vite` (без `tailwind.config.js`)
- **shadcn/ui** — стиль `radix-nova`, иконки `lucide-react`
- **React Router** — `HashRouter` (корректная работа SPA при хостинге на GitHub Pages)

## Команды

```bash
npm run dev      # dev-сервер
npm run build    # проверка типов (tsc -b) + production-сборка
npm run preview  # локальный предпросмотр сборки
npm run lint     # oxlint
```

## Структура

```
src/
  components/ui/   # компоненты shadcn/ui
  lib/utils.ts     # хелпер cn()
  App.tsx          # экраны/роуты приложения
  index.css        # Tailwind v4 + дизайн-токены темы
  main.tsx         # точка входа, HashRouter
```

## Добавление компонентов shadcn/ui

```bash
npx shadcn@latest add <component-name> -y
```

## Алиасы

Импорт из `src` — через алиас `@` (настроен в `vite.config.ts` и `tsconfig*.json`):

```ts
import { Button } from '@/components/ui/button'
```

## Авторизация и API

- Клиент API — `src/services/api.ts`, база: `https://functions.yandexcloud.net/d4ejgqppc85no82ns36m`
  (прямой вызов Yandex Cloud Function).
- Состояние авторизации — `src/context/AuthContext.tsx` (токен в `localStorage` под ключом `pedinburg_token`,
  хуки: `user`, `isLoading`, `isAuthenticated`, `isMaster`, `login`, `register`, `logout`, `updateProfile`, `deleteAccount`).
- UI: `src/components/Header.tsx`, `src/components/auth/AuthModal.tsx`, `src/components/profile/ProfileModal.tsx`.

### Почему маршрут передаётся в query-параметре

Прямой URL функции не поддерживает подпути: `https://functions.yandexcloud.net/<id>/ping` возвращает
`ProxyIntegrationError`. Поэтому клиент отправляет запрос на корень функции, а маршрут указывает параметром:

```
GET https://functions.yandexcloud.net/d4ejgqppc85no82ns36m?route=/ping
POST https://functions.yandexcloud.net/d4ejgqppc85no82ns36m?route=/auth/login
PUT https://functions.yandexcloud.net/d4ejgqppc85no82ns36m?route=/auth/me
```

`backend/index.js` разбирает маршрут в `resolvePath()` по приоритету: заголовок `X-Route` →
query-параметр `route` → обычный путь запроса (вариант за API Gateway). Методы `GET/POST/PUT/DELETE/OPTIONS`
прямым вызовом поддерживаются, CORS-заголовки отдаёт сам обработчик.

### Токен передаётся в `X-Auth-Token`

Заголовок `Authorization` при прямом вызове функции **нельзя**: платформа Yandex Cloud отвечает
`403 Forbidden: Not authorized` (он зарезервирован под IAM-токен и до функции не доходит). Поэтому
клиент (`src/services/api.ts`) отправляет JWT в заголовке `X-Auth-Token`, а бэкенд читает его
(фолбэк на `Authorization: Bearer` оставлен для схемы за API Gateway).

### Приключения и Telegram-бот (этап 2)

Бэкенд поддерживает создание приключений Мастерами и синхронизацию с Telegram-ботом:

- `POST /adventures/draft` — черновик + код синхронизации `PEDIN-XXXX` (только Мастер);
- `GET /adventures/draft-status?adventure_id=…` — статус привязки группы (только Мастер);
- `POST /adventures/publish` — публикация афиши: `status = active` + постер/логотип (только Мастер);
- `GET /adventures` — публичная афиша (активные приключения по дате игры);
- `POST /bot/sync`, `POST /bot/member-update` — внутренние роуты бота (заголовок `X-Bot-Secret`,
  переменная окружения `BOT_SECRET_KEY`).

Схема таблицы `adventures`, примеры curl и коды ошибок — в [`backend/README.md`](backend/README.md).

