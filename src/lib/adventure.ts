import type { Adventure } from '@/services/api'

/**
 * Форматтеры витрины приключений.
 *
 * Все функции рассчитаны на «грязные» данные из YDB: значения могут прийти
 * числом (числовые колонки), строкой, Date или null/undefined. Никаких строковых
 * методов без проверки типа — иначе афиша падала с `e.replace is not a function`.
 */

const MONTHS_GENITIVE = [
  'ЯНВАРЯ',
  'ФЕВРАЛЯ',
  'МАРТА',
  'АПРЕЛЯ',
  'МАЯ',
  'ИЮНЯ',
  'ИЮЛЯ',
  'АВГУСТА',
  'СЕНТЯБРЯ',
  'ОКТЯБРЯ',
  'НОЯБРЯ',
  'ДЕКАБРЯ',
]

const DEFAULT_LOGO_TOP = 55
const MAX_LOGO_TOP = 80

/** Безопасное приведение любого значения к строке. */
function toText(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim()
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  if (typeof value === 'boolean') {
    return String(value)
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString()
  }
  return ''
}

/** Безопасное приведение любого значения к числу (null — если привести нельзя). */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'string') {
    const parsed = Number(value.replace(',', '.').trim())
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function formatDateFromParts(day: number, monthIndex: number): string | null {
  const monthName = MONTHS_GENITIVE[monthIndex]
  if (!monthName || !Number.isFinite(day)) {
    return null
  }
  return `${day} ${monthName}`
}

function formatDateFromDate(date: Date): string | null {
  if (Number.isNaN(date.getTime())) {
    return null
  }
  return formatDateFromParts(date.getUTCDate(), date.getUTCMonth())
}

function formatTimeFromDate(date: Date): string | null {
  if (Number.isNaN(date.getTime())) {
    return null
  }
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
}

/** «7 ИЮНЯ» из '2026-06-07', Date, ISO-строки; null — если разобрать не удалось. */
export function formatDateLabel(value: unknown): string | null {
  if (value instanceof Date) {
    return formatDateFromDate(value)
  }

  const text = toText(value)
  if (!text) {
    return null
  }

  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text)
  if (match) {
    return formatDateFromParts(Number(match[3]), Number(match[2]) - 1)
  }

  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? null : formatDateFromDate(parsed)
}

/** «12:45» из '12:45', '12:45:00', Date или ISO-строки. */
export function formatTimeLabel(value: unknown): string | null {
  if (value instanceof Date) {
    return formatTimeFromDate(value)
  }

  const text = toText(value)
  if (!text) {
    return null
  }

  const match = /(\d{1,2}):(\d{2})/.exec(text)
  if (match) {
    return `${match[1].padStart(2, '0')}:${match[2]}`
  }

  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? null : formatTimeFromDate(parsed)
}

/** «7 ИЮНЯ С 12:45» — строка для шапки карточки. */
export function formatDateTimeLabel(adventure: Adventure | null | undefined): string {
  const date = formatDateLabel(adventure?.game_date)
  const time = formatTimeLabel(adventure?.game_time)
  if (date && time) {
    return `${date} С ${time}`
  }
  return date ?? time ?? 'БЕЗ ДАТЫ'
}

/** «12:45, 7 ИЮНЯ» — мета-строка под карточкой. */
export function formatTimeAndDate(adventure: Adventure | null | undefined): string {
  const date = formatDateLabel(adventure?.game_date)
  const time = formatTimeLabel(adventure?.game_time)
  return [time, date].filter(Boolean).join(', ') || 'БЕЗ ДАТЫ'
}

/** Склонение существительных: 1 игрок / 2 игрока / 5 игроков. */
export function pluralize(count: number, one: string, few: string, many: string): string {
  const absolute = Math.abs(count) % 100
  const lastDigit = absolute % 10
  if (absolute > 10 && absolute < 20) {
    return many
  }
  if (lastDigit === 1) {
    return one
  }
  if (lastDigit >= 2 && lastDigit <= 4) {
    return few
  }
  return many
}

/**
 * «990₽» — принимает число, строку («990 ₽»), null и undefined.
 * Строковые методы вызываются только после проверки типа.
 */
export function formatPrice(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 ? `${value}₽` : 'БЕСПЛАТНО'
  }

  const text = toText(value)
  if (!text) {
    return 'ЦЕНА УТОЧНЯЕТСЯ'
  }

  const numeric = Number(text.replace(/[^\d.,]/g, '').replace(',', '.'))
  if (Number.isFinite(numeric) && numeric > 0) {
    return `${numeric}₽`
  }
  return text.toUpperCase()
}

/** «ОТ 3 ДО 5 ИГРОКОВ». */
export function formatPlayersRange(min: unknown, max: unknown): string {
  const from = toNumber(min)
  const to = toNumber(max) ?? from
  if (!from || !to) {
    return 'ИГРОКИ НАБИРАЮТСЯ'
  }
  return `ОТ ${from} ДО ${to} ${pluralize(to, 'ИГРОКА', 'ИГРОКОВ', 'ИГРОКОВ')}`
}

/** «ОТ 4 ДО 5 ЧАСОВ» — витрина показывает диапазон сессии. */
export function formatDurationRange(hours: unknown): string {
  const value = toNumber(hours)
  if (!value) {
    return 'ДЛИТЕЛЬНОСТЬ УТОЧНЯЕТСЯ'
  }
  const to = value + 1
  return `ОТ ${value} ДО ${to} ${pluralize(to, 'ЧАСА', 'ЧАСОВ', 'ЧАСОВ')}`
}

/** Короткая подпись места для бейджа: «The Rooks», «Онлайн», «Место уточняется». */
export function formatLocationShort(value: unknown, isOnline?: unknown): string {
  const text = toText(value)
  if (text) {
    return text
  }
  return isOnline === true || toText(isOnline).toLowerCase() === 'true' ? 'Онлайн' : 'Место уточняется'
}

/** Место проведения капсом; для онлайна — «ОНЛАЙН», иначе «МЕСТО УТОЧНЯЕТСЯ». */
export function formatLocation(value: unknown, isOnline?: unknown): string {
  const text = formatLocationShort(value, isOnline)
  return text.toUpperCase()
}

/** Название приключения (пустое значение → «БЕЗ НАЗВАНИЯ»). */
export function formatTitle(value: unknown): string {
  return toText(value) || 'БЕЗ НАЗВАНИЯ'
}

/** Имя Мастера для подписей. */
export function formatMasterName(value: unknown): string {
  return toText(value) || 'МАСТЕР ИГРЫ'
}

/** Описание сюжета с дефолтом; переводы строк сохраняются. */
export function formatDescription(value: unknown): string {
  return toText(value) || 'Описание появится чуть позже.'
}

/**
 * Позиция логотипа: принимает `{ top: 45 }`, строку `'{"top":45}'`, число или null.
 */
export function parseLogoTop(value: unknown): number {
  let parsed: unknown = value

  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) {
      return DEFAULT_LOGO_TOP
    }
    try {
      parsed = JSON.parse(text)
    } catch {
      const numeric = Number(text)
      return Number.isFinite(numeric) ? clampLogoTop(numeric) : DEFAULT_LOGO_TOP
    }
  }

  if (typeof parsed === 'number') {
    return Number.isFinite(parsed) ? clampLogoTop(parsed) : DEFAULT_LOGO_TOP
  }

  if (parsed && typeof parsed === 'object' && 'top' in parsed) {
    const top = Number((parsed as { top: unknown }).top)
    return Number.isFinite(top) ? clampLogoTop(top) : DEFAULT_LOGO_TOP
  }

  return DEFAULT_LOGO_TOP
}

function clampLogoTop(value: number): number {
  return Math.min(Math.max(value, 0), MAX_LOGO_TOP)
}

/** Первая буква имени мастера для аватара. */
export function masterInitial(name: unknown): string {
  const trimmed = toText(name)
  return trimmed ? trimmed.charAt(0).toUpperCase() : 'М'
}

/** Уровень игроков на старте; пусто → «ЛЮБОЙ». */
export function formatPlayerLevel(value: unknown): string {
  return toText(value).toUpperCase() || 'ЛЮБОЙ'
}

/** Значение цены без валюты: 990 → «990»; нечисловой текст — как есть; пусто → null. */
export function formatPriceValue(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 ? String(value) : null
  }
  const text = toText(value)
  if (!text) {
    return null
  }
  const numeric = Number(text.replace(/[^\d.,]/g, '').replace(',', '.'))
  return Number.isFinite(numeric) && numeric > 0 ? String(numeric) : text
}

/** Игровая система приключения. */
export function formatSystem(value: unknown): string {
  return toText(value) || 'Система не указана'
}

/** Формат проведения: «Онлайн» или «Офлайн в баре». */
export function formatFormat(value: unknown): string {
  const text = toText(value).toLowerCase()
  return value === true || text === 'true' || text === 'онлайн' || text === 'online' ? 'Онлайн' : 'Офлайн в баре'
}

export interface PlayerSlots {
  current: number
  max: number
  free: number
}

/**
 * Слоты игроков. Мастер и бот в слотах не учитываются: `current_players`
 * из базы — это строго записавшиеся игроки.
 */
export function parsePlayerSlots(current: unknown, max: unknown): PlayerSlots {
  const maxPlayers = Math.max(Math.trunc(toNumber(max) ?? 0), 0)
  const rawCurrent = Math.max(Math.trunc(toNumber(current) ?? 0), 0)
  const occupied = maxPlayers > 0 ? Math.min(rawCurrent, maxPlayers) : rawCurrent
  return { current: occupied, max: maxPlayers, free: Math.max(maxPlayers - occupied, 0) }
}

/** Дополнительные особенности; пусто → null (блок не рендерится). */
export function formatNotes(value: unknown): string | null {
  const text = toText(value)
  return text.length > 0 ? text : null
}

/** Безопасный URL картинки: пустые и нестроковые значения → null. */
export function safeImageUrl(value: unknown): string | null {
  const text = toText(value)
  return text.length > 0 ? text : null
}
