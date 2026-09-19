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
