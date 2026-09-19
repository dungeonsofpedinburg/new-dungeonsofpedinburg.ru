import { X } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  formatDateTimeLabel,
  formatDescription,
  formatDurationRange,
  formatLocation,
  formatMasterName,
  formatNotes,
  formatPlayerLevel,
  formatPlayersRange,
  formatPrice,
  formatTitle,
  masterInitial,
  parseLogoTop,
  safeImageUrl,
} from '@/lib/adventure'
import type { Adventure } from '@/services/api'

const FALLBACK_POSTER_PATH = 'demo-poster.svg'

function assetUrl(path: string): string {
  return new URL(`${import.meta.env.BASE_URL}${path}`, window.location.href).href
}

function SpecCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-bold tracking-wider text-zinc-500 uppercase">{label}</dt>
      <dd className="mt-0.5 text-xs font-bold text-zinc-100 uppercase">{value}</dd>
    </div>
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
    if (adventure.tg_invite_link) {
      window.open(adventure.tg_invite_link, '_blank', 'noopener,noreferrer')
      return
    }
    toast.info('Ссылка на лобби формируется Мастером')
  }

  // Значения из YDB могут быть любого типа — приводим их защищёнными форматтерами.
  const posterUrl = safeImageUrl(adventure?.poster_url) ?? assetUrl(FALLBACK_POSTER_PATH)
  const logoUrl = safeImageUrl(adventure?.logo_url)
  const logoTop = parseLogoTop(adventure?.logo_position_json)
  const title = formatTitle(adventure?.title)
  const masterName = formatMasterName(adventure?.master_name)
  const location = formatLocation(adventure?.location, adventure?.is_online)
  const description = formatDescription(adventure?.description)
  const notes = formatNotes(adventure?.additional_notes)

  return (
    <Sheet open={Boolean(adventure)} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full gap-0 border-l border-zinc-800 bg-zinc-900 p-0 sm:max-w-md"
      >
        <SheetClose asChild>
          <button
            type="button"
            aria-label="Закрыть"
            className="absolute top-3 right-3 z-10 flex size-8 cursor-pointer items-center justify-center rounded-full bg-black/50 text-white backdrop-blur transition-colors hover:bg-black/70"
          >
            <X className="size-4" />
          </button>
        </SheetClose>
        {adventure ? (
          <div className="flex h-full flex-col">
            <SheetHeader className="sr-only">
              <SheetTitle>{title}</SheetTitle>
              <SheetDescription>Подробности приключения</SheetDescription>
            </SheetHeader>

            <div className="relative h-48 shrink-0 overflow-hidden">
              <div
                className="absolute inset-0 scale-110 bg-cover bg-center"
                style={{
                  backgroundImage: `url(${posterUrl})`,
                  filter: 'blur(40px) brightness(75%)',
                }}
              />
              <div className="absolute inset-0 bg-black/25" />
              <div className="absolute inset-0 flex items-center justify-center px-6">
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt=""
                    className="w-3/4 max-w-[75%] object-contain drop-shadow-2xl"
                    style={{ marginTop: `${(logoTop - 55) / 4}%` }}
                  />
                ) : (
                  <p className="text-center text-xl font-black tracking-wide text-white uppercase">{title}</p>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 pb-6">
              <h2 className="mt-4 text-2xl font-black tracking-tight text-white uppercase">{title}</h2>
              <p className="mt-3 text-sm leading-relaxed whitespace-pre-line text-zinc-300">{description}</p>

              <dl className="mt-6 grid grid-cols-2 gap-x-2 gap-y-4 border-y border-zinc-800/80 py-4">
                <SpecCell label="Дата и время" value={formatDateTimeLabel(adventure)} />
                <SpecCell label="Место проведения" value={location} />
                <SpecCell label="Стоимость для игрока" value={formatPrice(adventure?.price)} />
                <SpecCell label="Уровень на старте" value={formatPlayerLevel(adventure?.player_level)} />
                <SpecCell
                  label="Количество игроков"
                  value={formatPlayersRange(adventure?.min_players, adventure?.max_players)}
                />
                <SpecCell label="Продолжительность" value={formatDurationRange(adventure?.duration_hours)} />
              </dl>

              {notes ? <p className="mt-4 text-xs leading-relaxed text-zinc-400">{notes}</p> : null}

              <div className="mt-5 flex items-center gap-3">
                <Avatar size="lg">
                  <AvatarFallback>{masterInitial(adventure?.master_name)}</AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-[10px] font-bold text-zinc-500">МАСТЕР ИГРЫ</p>
                  <p className="text-xs font-bold text-zinc-100 uppercase">{masterName}</p>
                </div>
              </div>
            </div>

            <div className="shrink-0 border-t border-zinc-800 bg-zinc-900 p-4">
              <button
                type="button"
                onClick={handleJoin}
                className="w-full cursor-pointer rounded-xl bg-[#ec4899] py-6 text-sm font-black tracking-wider text-white uppercase shadow-lg transition-all hover:bg-pink-600"
              >
                Зайти в лобби
              </button>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
