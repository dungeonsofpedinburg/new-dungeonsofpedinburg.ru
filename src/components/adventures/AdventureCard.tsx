import { UserRound } from 'lucide-react'
import {
  formatDateTimeLabel,
  formatLocation,
  formatMasterName,
  formatPrice,
  formatTimeAndDate,
  formatTitle,
  parseLogoTop,
  safeImageUrl,
} from '@/lib/adventure'
import type { Adventure } from '@/services/api'

const FALLBACK_POSTER_PATH = 'demo-poster.svg'

function assetUrl(path: string): string {
  return new URL(`${import.meta.env.BASE_URL}${path}`, window.location.href).href
}

interface AdventureCardProps {
  adventure: Adventure
  onOpen: (adventure: Adventure) => void
}

export function AdventureCard({ adventure, onOpen }: AdventureCardProps) {
  // Все поля проходят через защищённые форматтеры: из YDB могут прийти числа, null или мусор.
  const posterUrl = safeImageUrl(adventure.poster_url) ?? assetUrl(FALLBACK_POSTER_PATH)
  const logoUrl = safeImageUrl(adventure.logo_url)
  const logoTop = parseLogoTop(adventure.logo_position_json)
  const location = formatLocation(adventure.location, adventure.is_online)
  const title = formatTitle(adventure.title)
  const masterName = formatMasterName(adventure.master_name)

  return (
    <button
      type="button"
      onClick={() => onOpen(adventure)}
      className="group block w-full cursor-pointer text-left focus-visible:outline-none"
    >
      <div className="relative aspect-[4/5] w-full overflow-hidden rounded-xl bg-zinc-900">
        <div
          className="absolute inset-0 bg-cover bg-center transition-transform duration-300 group-hover:scale-105"
          style={{ backgroundImage: `url(${posterUrl})` }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-transparent to-black/60" />

        <span className="absolute top-2 left-2 max-w-[58%] text-[10px] leading-tight font-bold text-white uppercase drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)]">
          {location}
        </span>
        <span className="absolute top-2 right-2 max-w-[42%] text-right text-[10px] leading-tight font-bold text-white uppercase drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)]">
          {formatDateTimeLabel(adventure)}
        </span>

        {logoUrl ? (
          <img
            src={logoUrl}
            alt=""
            className="absolute left-1/2 w-2/3 -translate-x-1/2 object-contain drop-shadow-lg"
            style={{ top: `${logoTop}%` }}
          />
        ) : null}
      </div>

      <h3 className="mt-3 text-base font-black tracking-wide text-white uppercase">{title}</h3>

      <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-zinc-400 uppercase">
        <span>{formatTimeAndDate(adventure)}</span>
        <span className="text-zinc-600">•</span>
        <span className="inline-flex items-center gap-1">
          <UserRound className="size-3" />
          {masterName}
        </span>
      </p>

      <span className="mt-1 inline-block rounded-full border border-zinc-700 px-2.5 py-0.5 text-xs font-semibold text-zinc-300">
        {formatPrice(adventure.price)}
      </span>
    </button>
  )
}
