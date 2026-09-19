import { useEffect, useState, type FormEvent } from 'react'
import { Check, Copy, Loader2, Sparkles, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { AspectRatio } from '@/components/ui/aspect-ratio'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Slider } from '@/components/ui/slider'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/context/AuthContext'
import { ApiError, api, type AdventureDraftPayload, type AdventureStatus } from '@/services/api'

const TOTAL_STEPS = 4
const POLL_INTERVAL_MS = 2500
const STEP_TITLES = ['Основа приключения', 'Дата и место', 'Подключение Telegram-лобби', 'Постер и оформление']
const GAME_SYSTEMS = ['D&D 2024', 'Daggerheart', 'Другая']
const PLAYER_LEVELS = ['Новички', '1-3 уровень', '4-6 уровень', '7+ уровень']
const DEMO_POSTER_PATH = 'demo-poster.svg'
const DEMO_LOGO_PATH = 'demo-logo.svg'

interface AdventureFormState {
  title: string
  description: string
  system: string
  customSystem: string
  isOnline: boolean
  playerLevel: string
  gameDate: string
  gameTime: string
  location: string
  minPlayers: string
  maxPlayers: string
  durationHours: string
  price: string
  additionalNotes: string
  posterUrl: string
  logoUrl: string
}

const INITIAL_FORM: AdventureFormState = {
  title: '',
  description: '',
  system: GAME_SYSTEMS[0],
  customSystem: '',
  isOnline: false,
  playerLevel: PLAYER_LEVELS[1],
  gameDate: '',
  gameTime: '19:00',
  location: '',
  minPlayers: '3',
  maxPlayers: '5',
  durationHours: '4',
  price: '990',
  additionalNotes: '',
  posterUrl: '',
  logoUrl: '',
}

function toNumber(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }
  const parsed = Number(trimmed.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : undefined
}

function describeError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback
}

/** Абсолютный URL демо-ассета (корректно работает и на GitHub Pages с base './'). */
function assetUrl(path: string): string {
  return new URL(`${import.meta.env.BASE_URL}${path}`, window.location.href).href
}

/** Компактная группа кнопок-переключателей (формат игры, уровень, тип проведения). */
function OptionButtonGroup({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant={value === option.value ? 'default' : 'outline'}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  )
}

interface CreateAdventureModalProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  /** Вызывается после успешной публикации — витрина обновляет список. */
  onPublished?: () => void
}

export function CreateAdventureModal({ isOpen, onOpenChange, onPublished }: CreateAdventureModalProps) {
  const { token } = useAuth()
  const [step, setStep] = useState(1)
  const [form, setForm] = useState<AdventureFormState>(INITIAL_FORM)
  const [adventureId, setAdventureId] = useState<string | null>(null)
  const [syncCode, setSyncCode] = useState('')
  const [draftStatus, setDraftStatus] = useState<AdventureStatus>('draft')
  const [isCreatingDraft, setIsCreatingDraft] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)
  const [isCopied, setIsCopied] = useState(false)
  const [logoTop, setLogoTop] = useState(60)

  const progressValue = (step / TOTAL_STEPS) * 100
  const isSynced = draftStatus === 'synced'
  const posterPreview = form.posterUrl.trim()
  const logoPreview = form.logoUrl.trim()

  function useDemoAssets() {
    setForm((current) => ({
      ...current,
      posterUrl: assetUrl(DEMO_POSTER_PATH),
      logoUrl: assetUrl(DEMO_LOGO_PATH),
    }))
    setLogoTop(55)
    toast.success('Подставлены демо-постер и логотип')
  }

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      // при каждом открытии визард начинается заново
      setStep(1)
      setForm(INITIAL_FORM)
      setAdventureId(null)
      setSyncCode('')
      setDraftStatus('draft')
      setIsCreatingDraft(false)
      setIsPublishing(false)
      setIsCopied(false)
      setLogoTop(60)
    }
    onOpenChange(nextOpen)
  }

  function updateField<K extends keyof AdventureFormState>(key: K, value: AdventureFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function goToStepTwo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!form.title.trim()) {
      toast.error('Укажите название приключения')
      return
    }
    if (!form.description.trim()) {
      toast.error('Добавьте описание сюжета')
      return
    }
    setStep(2)
  }

  function buildDraftPayload(): AdventureDraftPayload {
    const system = form.system === 'Другая' ? form.customSystem.trim() : form.system
    return {
      title: form.title.trim(),
      description: form.description.trim(),
      system: system || undefined,
      is_online: form.isOnline,
      player_level: form.playerLevel.trim() || undefined,
      game_date: form.gameDate || undefined,
      game_time: form.gameTime || undefined,
      location: form.location.trim() || undefined,
      min_players: toNumber(form.minPlayers),
      max_players: toNumber(form.maxPlayers),
      duration_hours: toNumber(form.durationHours),
      price: toNumber(form.price),
      additional_notes: form.additionalNotes.trim() || undefined,
    }
  }

  async function handleCreateDraft() {
    if (!token) {
      toast.error('Требуется авторизация Мастера')
      return
    }
    setIsCreatingDraft(true)
    try {
      const response = await api.createAdventureDraft(buildDraftPayload(), token)
      setAdventureId(response.adventure_id)
      setSyncCode(response.sync_code)
      setDraftStatus('draft')
      setStep(3)
      toast.success('Черновик создан, код лобби готов')
    } catch (error) {
      toast.error(describeError(error, 'Не удалось создать черновик приключения'))
    } finally {
      setIsCreatingDraft(false)
    }
  }

  async function handleCopyCode() {
    try {
      await navigator.clipboard.writeText(syncCode)
      setIsCopied(true)
      toast.success('Код скопирован — отправьте его в группу Telegram')
      window.setTimeout(() => setIsCopied(false), 2500)
    } catch {
      toast.error('Браузер не дал скопировать код — выделите его вручную')
    }
  }

  // Тихий поллинг: как только бот привязал группу, автоматически переходим на Шаг 4.
  useEffect(() => {
    if (!isOpen || step !== 3 || !adventureId || !token) {
      return
    }

    let cancelled = false
    let timer: number | undefined

    const poll = async () => {
      try {
        const status = await api.getDraftStatus(adventureId, token)
        if (cancelled) {
          return
        }
        setDraftStatus(status.status)
        if (status.status === 'synced') {
          window.setTimeout(() => {
            if (!cancelled) {
              setStep(4)
            }
          }, 1200)
          return
        }
      } catch {
        // тихий поллинг: сетевые сбои просто откладывают следующую попытку
      }
      if (!cancelled) {
        timer = window.setTimeout(poll, POLL_INTERVAL_MS)
      }
    }

    timer = window.setTimeout(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      if (timer) {
        window.clearTimeout(timer)
      }
    }
  }, [isOpen, step, adventureId, token])

  async function handlePublish() {
    if (!token) {
      toast.error('Требуется авторизация Мастера')
      return
    }
    if (!adventureId) {
      toast.error('Сначала создайте черновик приключения')
      return
    }
    setIsPublishing(true)
    try {
      await api.publishAdventure(
        {
          adventure_id: adventureId,
          poster_url: form.posterUrl.trim() || undefined,
          logo_url: form.logoUrl.trim() || undefined,
          logo_position_json: JSON.stringify({ top: logoTop }),
        },
        token,
      )
      toast.success('Приключение опубликовано — ищите его в афише!')
      onPublished?.()
      onOpenChange(false)
    } catch (error) {
      toast.error(describeError(error, 'Не удалось опубликовать приключение'))
    } finally {
      setIsPublishing(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[92svh] w-[calc(100vw-1.5rem)] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Создание приключения</DialogTitle>
          <DialogDescription>
            Шаг {step} из {TOTAL_STEPS}: {STEP_TITLES[step - 1]}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Progress value={progressValue} className="h-1.5" />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Шаг {step} из {TOTAL_STEPS}
            </span>
            <span className="truncate">{STEP_TITLES[step - 1]}</span>
          </div>
        </div>

        {step === 1 ? (
          <form className="grid gap-4" onSubmit={goToStepTwo}>
            <div className="grid gap-2">
              <Label htmlFor="adventure-title">Название приключения</Label>
              <Input
                id="adventure-title"
                required
                maxLength={200}
                placeholder="Тени Пединбурга"
                value={form.title}
                onChange={(event) => updateField('title', event.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="adventure-description">Описание сюжета</Label>
              <Textarea
                id="adventure-description"
                required
                rows={4}
                maxLength={5000}
                placeholder="Город накрыла тень: кто-то ворует имена у горожан. Наймитесь на расследование…"
                value={form.description}
                onChange={(event) => updateField('description', event.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label>Игровая система</Label>
              <OptionButtonGroup
                options={GAME_SYSTEMS.map((system) => ({ value: system, label: system }))}
                value={form.system}
                onChange={(value) => updateField('system', value)}
              />
              {form.system === 'Другая' ? (
                <Input
                  placeholder="Название системы"
                  value={form.customSystem}
                  onChange={(event) => updateField('customSystem', event.target.value)}
                />
              ) : null}
            </div>

            <div className="grid gap-2">
              <Label>Формат проведения</Label>
              <OptionButtonGroup
                options={[
                  { value: 'offline', label: 'Офлайн (в баре)' },
                  { value: 'online', label: 'Онлайн' },
                ]}
                value={form.isOnline ? 'online' : 'offline'}
                onChange={(value) => updateField('isOnline', value === 'online')}
              />
            </div>

            <div className="grid gap-2">
              <Label>Уровень игроков</Label>
              <OptionButtonGroup
                options={PLAYER_LEVELS.map((level) => ({ value: level, label: level }))}
                value={form.playerLevel}
                onChange={(value) => updateField('playerLevel', value)}
              />
            </div>

            <Button type="submit" size="lg" className="w-full">
              Далее
            </Button>
          </form>
        ) : null}

        {step === 2 ? (
          <form className="grid gap-4" onSubmit={(event) => event.preventDefault()}>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="adventure-date">Дата игры</Label>
                <Input
                  id="adventure-date"
                  type="date"
                  value={form.gameDate}
                  onChange={(event) => updateField('gameDate', event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="adventure-time">Время</Label>
                <Input
                  id="adventure-time"
                  type="time"
                  value={form.gameTime}
                  onChange={(event) => updateField('gameTime', event.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="adventure-location">Место проведения</Label>
              <Input
                id="adventure-location"
                placeholder="Бар The Rooks, ул. Коммунистическая 45"
                value={form.location}
                onChange={(event) => updateField('location', event.target.value)}
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="adventure-min">Мин. игроков</Label>
                <Input
                  id="adventure-min"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={100}
                  value={form.minPlayers}
                  onChange={(event) => updateField('minPlayers', event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="adventure-max">Макс. игроков</Label>
                <Input
                  id="adventure-max"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={100}
                  value={form.maxPlayers}
                  onChange={(event) => updateField('maxPlayers', event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="adventure-duration">Часов</Label>
                <Input
                  id="adventure-duration"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={72}
                  value={form.durationHours}
                  onChange={(event) => updateField('durationHours', event.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="adventure-price">Стоимость участия с игрока, ₽</Label>
              <Input
                id="adventure-price"
                type="number"
                inputMode="numeric"
                min={0}
                step={50}
                value={form.price}
                onChange={(event) => updateField('price', event.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="adventure-notes">Дополнительные особенности</Label>
              <Textarea
                id="adventure-notes"
                rows={3}
                maxLength={5000}
                placeholder="18+, первый напиток входит в стоимость"
                value={form.additionalNotes}
                onChange={(event) => updateField('additionalNotes', event.target.value)}
              />
            </div>

            <div className="flex flex-col gap-2 sm:flex-row-reverse">
              <Button type="button" size="lg" className="sm:flex-1" disabled={isCreatingDraft} onClick={handleCreateDraft}>
                {isCreatingDraft ? <Loader2 className="size-4 animate-spin" /> : <Wand2 />}
                Сгенерировать код лобби
              </Button>
              <Button type="button" variant="outline" size="lg" onClick={() => setStep(1)} disabled={isCreatingDraft}>
                Назад
              </Button>
            </div>
          </form>
        ) : null}

        {step === 3 ? (
          <div className="grid gap-4">
            <div className="rounded-xl border border-border bg-muted/40 p-4 text-center">
              <p className="text-xs tracking-wide text-muted-foreground uppercase">Код синхронизации</p>
              <p className="mt-2 font-heading text-3xl font-semibold tracking-[0.18em]">{syncCode || '—'}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={handleCopyCode} disabled={!syncCode}>
                {isCopied ? <Check /> : <Copy />}
                {isCopied ? 'Скопировано' : 'Скопировать код'}
              </Button>
            </div>

            <div className="grid gap-2 rounded-xl border border-border p-4">
              <p className="text-sm font-medium">Как подключить лобби</p>
              <ol className="grid gap-2 text-sm text-muted-foreground">
                <li>1. Создайте группу в Telegram для игроков.</li>
                <li>
                  2. Добавьте в группу бота{' '}
                  <span className="font-medium text-foreground">@dungeonsofpedinburg_bot</span> и сделайте его
                  администратором.
                </li>
                <li>3. Отправьте в группу скопированный код.</li>
              </ol>
            </div>

            {isSynced ? (
              <div className="flex items-center gap-3 rounded-xl border border-primary/40 bg-primary/10 p-4">
                <Check className="size-5 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-medium">Группа успешно подключена!</p>
                  <p className="text-xs text-muted-foreground">Переходим к оформлению постера…</p>
                </div>
              </div>
            ) : (
              <div className="flex animate-pulse items-center gap-3 rounded-xl border border-border bg-muted/40 p-4">
                <Loader2 className="size-5 shrink-0 animate-spin text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Ожидаем подтверждения от бота…</p>
                  <p className="text-xs text-muted-foreground">Статус проверяется каждые 2,5 секунды, окно можно не закрывать.</p>
                </div>
              </div>
            )}

            <div className="flex flex-col-reverse items-center gap-2 sm:flex-row sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground"
                onClick={() => setStep(4)}
              >
                Пропустить шаг для теста
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setStep(2)}>
                Назад
              </Button>
            </div>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="adventure-poster">URL постера (пропорция 4×5)</Label>
              <Input
                id="adventure-poster"
                placeholder="https://…/poster.png"
                value={form.posterUrl}
                onChange={(event) => updateField('posterUrl', event.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="adventure-logo">URL прозрачного PNG-логотипа</Label>
              <Input
                id="adventure-logo"
                placeholder="https://…/logo.png"
                value={form.logoUrl}
                onChange={(event) => updateField('logoUrl', event.target.value)}
              />
            </div>

            <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto" onClick={useDemoAssets}>
              <Sparkles />
              Использовать демо-постер
            </Button>

            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Макет для карточки на сайте</p>
                <span className="text-xs text-muted-foreground">логотип на {logoTop}% ниже верха</span>
              </div>

              <AspectRatio ratio={4 / 5} className="overflow-hidden rounded-xl bg-muted">
                <div
                  className="absolute inset-0 bg-cover bg-center"
                  style={posterPreview ? { backgroundImage: `url(${posterPreview})` } : undefined}
                />
                {logoPreview ? (
                  <img
                    src={logoPreview}
                    alt="Логотип приключения"
                    className="absolute left-1/2 w-3/4 -translate-x-1/2 object-contain drop-shadow-lg"
                    style={{ top: `${logoTop}%` }}
                  />
                ) : null}
                {!posterPreview && !logoPreview ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-muted/60 px-4 text-center text-xs text-muted-foreground">
                    Вставьте ссылки на постер и логотип или нажмите «Использовать демо-постер»
                  </div>
                ) : null}
              </AspectRatio>

              <Slider
                value={[logoTop]}
                min={0}
                max={80}
                step={1}
                onValueChange={(values) => setLogoTop(values[0] ?? 0)}
              />
            </div>

            <div className="grid gap-2">
              <p className="text-sm font-medium">Макет для окна приключения (автоматический)</p>
              <div className="relative aspect-video overflow-hidden rounded-xl bg-muted">
                <div
                  className="absolute inset-0 scale-110 bg-cover bg-center"
                  style={{
                    backgroundImage: posterPreview ? `url(${posterPreview})` : undefined,
                    filter: 'blur(50px) brightness(80%)',
                  }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  {logoPreview ? (
                    <img src={logoPreview} alt="Логотип приключения" className="w-3/4 object-contain drop-shadow-xl" />
                  ) : (
                    <span className="text-xs text-muted-foreground">Логотип не задан</span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row-reverse">
              <Button type="button" size="lg" className="sm:flex-1" disabled={isPublishing} onClick={handlePublish}>
                {isPublishing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles />}
                Опубликовать приключение
              </Button>
              <Button type="button" variant="outline" size="lg" onClick={() => setStep(3)} disabled={isPublishing}>
                Назад
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
