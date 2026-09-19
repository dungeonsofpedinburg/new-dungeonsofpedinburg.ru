import { Calendar, Clock, Coins, Dices, MapPin, Send, User, UserPlus, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { AspectRatio } from '@/components/ui/aspect-ratio'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  formatDateLabel,
  formatDescription,
  formatFormat,
  formatLocationShort,
  formatMasterName,
  formatPriceValue,
  formatSystem,
  formatTimeLabel,
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

/** Строка характеристик: иконка в квадрате + подпись и значение. */
function SpecRow({ icons, label, value }: { icons: LucideIcon[]; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center gap-0.5 rounded-lg bg-muted text-muted-foreground">
        {icons.map((Icon, index) => (
          <Icon key={index} className="size-4" />
        ))}
      </span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium break-words">{value}</p>
      </div>
    </div>
  )
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

interface AdventureDetailSheetProps {
  adventure: Adventure | null
  onOpenChange: (open: boolean) => void
}

export function AdventureDetailSheet({ adventure, onOpenChange }: AdventureDetailSheetProps) {
  function handleJoin() {
    if (!adventure) {
      return
    }
    const inviteLink = safeImageUrl(adventure.tg_invite_link)
    if (inviteLink) {
      window.open(inviteLink, '_blank', 'noopener,noreferrer')
      return
    }
    toast.info('Ссылка на лобби формируется Мастером')
  }

  const posterUrl = safeImageUrl(adventure?.poster_url) ?? assetUrl(FALLBACK_POSTER_PATH)
  const logoUrl = safeImageUrl(adventure?.logo_url)
  const logoTop = parseLogoTop(adventure?.logo_position_json)
  const title = formatTitle(adventure?.title)
  const masterName = formatMasterName(adventure?.master_name)
  const system = formatSystem(adventure?.system)
  const location = formatLocationShort(adventure?.location, adventure?.is_online)
  const description = formatDescription(adventure?.description)
  const dateLabel = formatDateLabel(adventure?.game_date)
  const timeLabel = formatTimeLabel(adventure?.game_time)
  const priceValue = formatPriceValue(adventure?.price)
  const slots = parsePlayerSlots(adventure?.current_players, adventure?.max_players)
  const renderedSlots = Math.min(slots.max, MAX_RENDERED_SLOTS)
  const dateTimeLabel = [dateLabel ?? 'Дата уточняется', timeLabel].filter(Boolean).join(', ')

  return (
    <Sheet open={Boolean(adventure)} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
        {adventure ? (
          <div className="flex h-full flex-col overflow-hidden">
            <SheetHeader className="gap-3">
              <AspectRatio ratio={16 / 9} className="overflow-hidden rounded-lg border border-border bg-muted">
                <img
                  src={posterUrl}
                  alt=""
                  className="absolute inset-0 size-full scale-105 object-cover"
                  style={{ filter: 'blur(3px) brightness(0.85)' }}
                />
                <div className="absolute inset-0 flex items-center justify-center p-4">
                  {logoUrl ? (
                    <img
                      src={logoUrl}
                      alt=""
                      className="max-h-full w-3/4 object-contain drop-shadow-xl"
                      style={{ marginTop: `${(logoTop - 55) / 4}%` }}
                    />
                  ) : (
                    <span className="text-center text-base font-bold text-white">{title}</span>
                  )}
                </div>
              </AspectRatio>

              <SheetTitle className="text-xl font-extrabold tracking-tight">{title}</SheetTitle>
              <SheetDescription>
                {system} · {formatFormat(adventure.is_online)}
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 space-y-5 overflow-y-auto px-4 pt-4 pb-2">
              <div className="space-y-4">
                <SpecRow icons={[Calendar, Clock]} label="Дата и время" value={dateTimeLabel} />
                <SpecRow icons={[MapPin]} label="Место проведения" value={location} />
                <SpecRow icons={[Dices]} label="Формат" value={formatFormat(adventure.is_online)} />
                <SpecRow icons={[Coins]} label="Стоимость" value={priceValue ? `${priceValue} ₽` : 'Уточняется'} />
              </div>

              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="text-sm font-medium">Свободные места</p>

                {slots.max > 0 ? (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {Array.from({ length: renderedSlots }, (_, index) => (
                      <PlayerSlot key={index} filled={index < slots.current} />
                    ))}
                    <span className="text-xs text-muted-foreground">
                      {slots.current}/{slots.max}
                    </span>
                  </div>
                ) : null}

                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {slots.max > 0
                    ? `Занято ${slots.current} из ${slots.max} мест. Свободно ${slots.free} мест. (Мастер игры не занимает слот игрока)`
                    : `Уже записалось игроков: ${slots.current}. (Мастер игры не занимает слот игрока)`}
                </p>
              </div>

              <div>
                <p className="text-sm font-medium">Описание</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground whitespace-pre-line">{description}</p>
              </div>

              <div className="flex items-center gap-3">
                <Avatar size="lg">
                  <AvatarFallback>{masterInitial(adventure.master_name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{masterName}</p>
                  <Badge variant="secondary" className="mt-1">
                    Мастер игры
                  </Badge>
                </div>
              </div>
            </div>

            <SheetFooter className="border-t border-border">
              <Button size="lg" className="w-full font-bold" onClick={handleJoin}>
                <Send />
                ЗАЙТИ В ЛОББИ
              </Button>
            </SheetFooter>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
