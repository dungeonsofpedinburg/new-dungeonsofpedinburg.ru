import { Calendar, MapPin, User, UserPlus } from 'lucide-react'
import { AspectRatio } from '@/components/ui/aspect-ratio'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import {
  formatDateLabel,
  formatLocationShort,
  formatMasterName,
  formatPriceValue,
  formatSystem,
  formatTitle,
  masterInitial,
  parseLogoTop,
  parsePlayerSlots,
  safeImageUrl,
} from '@/lib/adventure'
import type { Adventure } from '@/services/api'

const FALLBACK_POSTER_PATH = 'demo-poster.svg'
const MAX_RENDERED_SLOTS = 10

function assetUrl(path: string): string {
  return new URL(`${import.meta.env.BASE_URL}${path}`, window.location.href).href
}

/** Круглый слот игрока: занятый — заливка, свободный — пунктир. */
function PlayerSlot({ filled }: { filled: boolean }) {
  if (filled) {
    return (
      <span className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <User className="size-3.5" />
      </span>
    )
  }
  return (
    <span className="flex size-6 items-center justify-center rounded-full border border-dashed border-muted-foreground/40 bg-muted/20 text-muted-foreground">
      <UserPlus className="size-3.5" />
    </span>
  )
}

interface AdventureCardProps {
  adventure: Adventure
  onOpen: (adventure: Adventure) => void
}

export function AdventureCard({ adventure, onOpen }: AdventureCardProps) {
  // Значения из YDB могут быть любого типа — все поля идут через защищённые форматтеры.
  const posterUrl = safeImageUrl(adventure.poster_url) ?? assetUrl(FALLBACK_POSTER_PATH)
  const logoUrl = safeImageUrl(adventure.logo_url)
  const logoTop = parseLogoTop(adventure.logo_position_json)
  const title = formatTitle(adventure.title)
  const masterName = formatMasterName(adventure.master_name)
  const system = formatSystem(adventure.system)
  const location = formatLocationShort(adventure.location, adventure.is_online)
  const dateLabel = formatDateLabel(adventure.game_date) ?? 'Без даты'
  const priceValue = formatPriceValue(adventure.price)
  const slots = parsePlayerSlots(adventure.current_players, adventure.max_players)
  const renderedSlots = Math.min(slots.max, MAX_RENDERED_SLOTS)

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => onOpen(adventure)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(adventure)
        }
      }}
      className="group flex cursor-pointer flex-col overflow-hidden border-border bg-card pt-0 text-card-foreground transition-all hover:border-primary/50"
    >
      <div className="relative">
        <AspectRatio ratio={4 / 5} className="overflow-hidden bg-muted">
          <img
            src={posterUrl}
            alt={title}
            loading="lazy"
            className="absolute inset-0 size-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
          {logoUrl ? (
            <img
              src={logoUrl}
              alt=""
              loading="lazy"
              className="absolute left-1/2 w-2/3 -translate-x-1/2 object-contain drop-shadow-lg"
              style={{ top: `${logoTop}%` }}
            />
          ) : null}
        </AspectRatio>

        <Badge variant="secondary" className="absolute top-2 left-2 max-w-[58%] gap-1 bg-background/80 backdrop-blur-md">
          <MapPin className="size-3" />
          <span className="truncate">{location}</span>
        </Badge>
        <Badge variant="secondary" className="absolute top-2 right-2 gap-1 bg-background/80 backdrop-blur-md">
          <Calendar className="size-3" />
          {dateLabel}
        </Badge>
      </div>

      <CardHeader>
        <CardTitle className="line-clamp-1 text-lg font-bold">{title}</CardTitle>
      </CardHeader>

      <CardContent className="flex items-center gap-2">
        <Avatar size="sm">
          <AvatarFallback>{masterInitial(adventure.master_name)}</AvatarFallback>
        </Avatar>
        <span className="truncate text-sm text-muted-foreground">{masterName}</span>
        <Badge variant="outline" className="ml-auto shrink-0">
          {system}
        </Badge>
      </CardContent>

      <CardFooter className="flex-col items-start gap-2">
        <Badge variant="default" className="text-sm font-bold">
          {priceValue ? `${priceValue} ₽` : 'Цена уточняется'}
        </Badge>

        {slots.max > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {Array.from({ length: renderedSlots }, (_, index) => (
              <PlayerSlot key={index} filled={index < slots.current} />
            ))}
            <span className="text-xs text-muted-foreground">
              {slots.current}/{slots.max}
            </span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Записалось игроков: {slots.current}</span>
        )}
      </CardFooter>
    </Card>
  )
}
