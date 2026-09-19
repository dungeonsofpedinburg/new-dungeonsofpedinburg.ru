import type { Adventure } from '@/services/api'

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

/** «7 ИЮНЯ» — без года, капсом. */
export function formatDateLabel(date: string | null): string | null {
  if (!date) {
    return null
  }
  const [year, month, day] = date.split('-').map((part) => Number(part))
  if (!year || !month || !day) {
    return null
  }
  const monthName = MONTHS_GENITIVE[month - 1]
  return monthName ? `${day} ${monthName}` : null
}

/** «7 ИЮНЯ С 12:45» — строка для шапки карточки. */
export function formatDateTimeLabel(adventure: Adventure): string {
  const date = formatDateLabel(adventure.game_date)
  const time = adventure.game_time?.slice(0, 5)
  if (date && time) {
    return `${date} С ${time}`
  }
  return date ?? time ?? 'ДАТА УТОЧНЯЕТСЯ'
}

/** «12:45, 7 ИЮНЯ» — мета-строка под карточкой. */
export function formatTimeAndDate(adventure: Adventure): string {
  const date = formatDateLabel(adventure.game_date)
  const time = adventure.game_time?.slice(0, 5)
  return [time, date].filter(Boolean).join(', ') || 'ДАТА УТОЧНЯЕТСЯ'
}

/** «990₽» либо исходный текст («Бесплатно» и т.п.). */
export function formatPrice(price: string | null): string {
  if (!price) {
    return 'ЦЕНА УТОЧНЯЕТСЯ'
  }
  const numeric = Number(price.replace(/[^\d.,]/g, '').replace(',', '.'))
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return price.toUpperCase()
  }
  return `${numeric.toLocaleString('ru-RU')}₽`
}

/** «ОТ 3 ДО 5 ИГРОКОВ». */
export function formatPlayersRange(min: number | null, max: number | null): string {
  const to = max ?? min
  if (!min || !to) {
    return 'ИГРОКИ НАБИРАЮТСЯ'
  }
  return `ОТ ${min} ДО ${to} ${pluralize(to, 'ИГРОКА', 'ИГРОКОВ', 'ИГРОКОВ')}`
}

/** «ОТ 4 ДО 5 ЧАСОВ» — витрина показывает диапазон сессии. */
export function formatDurationRange(hours: number | null): string {
  if (!hours) {
    return 'ДЛИТЕЛЬНОСТЬ УТОЧНЯЕТСЯ'
  }
  const to = hours + 1
  return `ОТ ${hours} ДО ${to} ${pluralize(to, 'ЧАСА', 'ЧАСОВ', 'ЧАСОВ')}`
}

/** Позиция логотипа из logo_position_json: { top: 45 } → 45. */
export function parseLogoTop(logoPositionJson: string | null): number {
  if (!logoPositionJson) {
    return 55
  }
  try {
    const parsed: unknown = JSON.parse(logoPositionJson)
    if (parsed && typeof parsed === 'object' && 'top' in parsed) {
      const top = Number((parsed as { top: unknown }).top)
      if (Number.isFinite(top)) {
        return Math.min(Math.max(top, 0), 80)
      }
    }
  } catch {
    // некорректный JSON — используем значение по умолчанию
  }
  return 55
}

/** Первая буква имени мастера для аватара. */
export function masterInitial(name: string): string {
  const trimmed = name.trim()
  return trimmed ? trimmed.charAt(0).toUpperCase() : 'М'
}
