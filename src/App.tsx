import { Component, useCallback, useEffect, useState, type ReactNode } from 'react'
import { Loader2, LogIn, Plus } from 'lucide-react'
import { AdventureCard } from '@/components/adventures/AdventureCard'
import { AdventureDetailSheet } from '@/components/adventures/AdventureDetailSheet'
import { CreateAdventureModal } from '@/components/adventures/CreateAdventureModal'
import { AuthModal } from '@/components/auth/AuthModal'
import { Header } from '@/components/Header'
import { ProfileModal } from '@/components/profile/ProfileModal'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import { api, type Adventure } from '@/services/api'

function assetUrl(path: string): string {
  return new URL(`${import.meta.env.BASE_URL}${path}`, window.location.href).href
}

/**
 * Демо-приключения: показываются, пока Мастера не опубликовали свои игры
 * (или если запрос к API не удался).
 */
function buildDemoAdventures(): Adventure[] {
  return [
    {
      id: 'demo-zayeltsovsky-oskal',
      master_id: 'demo-master-1',
      master_name: 'Дима Шило',
      title: 'Заельцовский оскал',
      description:
        'В Заельцовском бору находят тела, а звери не оставляют таких следов. Стража списывает всё на волков, но друид-отшельник клянётся: во тьме он слышал человеческий голос.\n\nВас нанимают разобраться до новолуния. Возьмите фонари, серебро и немного удачи — лес не прощает самоуверенных.',
      system: 'D&D 2024',
      is_online: false,
      player_level: '1-3 уровень',
      game_date: '2026-10-03',
      game_time: '12:45',
      duration_hours: 4,
      location: 'Красный проспект, 15',
      price: '990',
      min_players: 3,
      max_players: 5,
      current_players: 3,
      additional_notes: '18+, первый напиток входит в стоимость.',
      status: 'active',
      sync_code: 'PEDIN-DEMO1',
      tg_group_id: null,
      tg_invite_link: null,
      poster_url: assetUrl('demo-poster-zayeltsovsky.svg'),
      logo_url: assetUrl('demo-logo.svg'),
      logo_position_json: '{"top":45}',
      created_at: null,
      updated_at: null,
    },
    {
      id: 'demo-osobaya-ohota',
      master_id: 'demo-master-2',
      master_name: 'Аня Волкова',
      title: 'Особая охота',
      description:
        'Кто-то открыл охоту на тех, кто охотился сам. Три трупа, один герб, и все следы ведут в закрытый клуб «Особая охота» на Коммунистической.\n\nВнутри — джентльмены в смокингах, лисьи маски и правила, за нарушение которых платят не деньгами. Вам нужен пригласительный. И алиби.',
      system: 'Daggerheart',
      is_online: false,
      player_level: '4-6 уровень',
      game_date: '2026-10-11',
      game_time: '19:00',
      duration_hours: 5,
      location: 'Бар The Rooks, Коммунистическая 45',
      price: '1200',
      min_players: 2,
      max_players: 4,
      current_players: 2,
      additional_notes: '18+, желательны собственные кубики.',
      status: 'active',
      sync_code: 'PEDIN-DEMO2',
      tg_group_id: null,
      tg_invite_link: 'https://t.me/dungeonsofpedinburg',
      poster_url: assetUrl('demo-poster-hunt.svg'),
      logo_url: assetUrl('demo-logo.svg'),
      logo_position_json: '{"top":62}',
      created_at: null,
      updated_at: null,
    },
  ]
}

/** Оставляем в списке только похожие на приключение объекты (защита от мусора в БД). */
function normalizeAdventures(value: unknown): Adventure[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item) => typeof item === 'object' && item !== null && 'id' in item) as Adventure[]
}

/**
 * Предохранитель витрины: битые данные одного приключения не должны
 * уронить всю афишу в чёрный экран.
 */
class AdventureBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: unknown) {
    console.error('Ошибка отображения приключения:', error)
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children
  }
}

function BrokenCard() {
  return (
    <div className="flex aspect-[4/5] items-center justify-center rounded-xl border border-border bg-muted/20 p-3 text-center text-xs font-medium text-muted-foreground">
      Не удалось показать приключение
    </div>
  )
}

/** Загружает афишу; если активных игр нет или запрос упал — отдаёт демо-набор. */
async function fetchAdventures(): Promise<Adventure[]> {
  try {
    const response = await api.getAdventures()
    const list = normalizeAdventures(response.adventures)
    return list.length > 0 ? list : buildDemoAdventures()
  } catch {
    // витрина не должна пустовать из-за сетевой ошибки
    return buildDemoAdventures()
  }
}

function HomeScreen() {
  const { user, isAuthenticated, isMaster, isLoading } = useAuth()
  const [adventures, setAdventures] = useState<Adventure[]>([])
  const [isLoadingAdventures, setIsLoadingAdventures] = useState(true)
  const [selectedAdventure, setSelectedAdventure] = useState<Adventure | null>(null)
  const [isAuthOpen, setIsAuthOpen] = useState(false)
  const [isProfileOpen, setIsProfileOpen] = useState(false)
  const [isCreateAdventureOpen, setIsCreateAdventureOpen] = useState(false)

  const loadAdventures = useCallback(async () => {
    setAdventures(await fetchAdventures())
    setIsLoadingAdventures(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    void fetchAdventures().then((list) => {
      if (cancelled) {
        return
      }
      setAdventures(list)
      setIsLoadingAdventures(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const subtitle =
    isAuthenticated && user
      ? `Вы вошли как ${user.name}${isMaster ? ' · Мастер игры' : ' · Игрок'}`
      : 'Настольные приключения в барах Пединбурга'

  return (
    // Тема проекта — всегда dark, класс вешаем на корневой контейнер.
    <div className="dark flex min-h-svh flex-col bg-background text-foreground">
      <Header
        onRequestAuth={() => setIsAuthOpen(true)}
        onRequestProfile={() => setIsProfileOpen(true)}
        onRequestCreateAdventure={() => setIsCreateAdventureOpen(true)}
      />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Список игр</h1>
            <p className="mt-1 truncate text-sm text-muted-foreground">{subtitle}</p>
          </div>

          <div className="flex items-center gap-2">
            {isMaster ? (
              <Button size="sm" className="font-bold" onClick={() => setIsCreateAdventureOpen(true)}>
                <Plus />
                Создать приключение
              </Button>
            ) : null}

            {!isAuthenticated ? (
              <Button size="sm" variant="outline" className="font-bold" onClick={() => setIsAuthOpen(true)}>
                <LogIn />
                Войти
              </Button>
            ) : null}
          </div>
        </div>

        {isLoading || isLoadingAdventures ? (
          <div className="flex items-center justify-center gap-3 py-20 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Загружаем игры…
          </div>
        ) : adventures.length === 0 ? (
          <p className="py-20 text-center text-sm text-muted-foreground">
            Пока нет опубликованных игр — станьте первым Мастером!
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {adventures.map((adventure) => (
              <AdventureBoundary key={adventure.id} fallback={<BrokenCard />}>
                <AdventureCard adventure={adventure} onOpen={setSelectedAdventure} />
              </AdventureBoundary>
            ))}
          </div>
        )}
      </main>

      <AuthModal open={isAuthOpen} onOpenChange={setIsAuthOpen} />
      <ProfileModal open={isProfileOpen} onOpenChange={setIsProfileOpen} />
      <CreateAdventureModal
        isOpen={isCreateAdventureOpen}
        onOpenChange={setIsCreateAdventureOpen}
        onPublished={() => {
          void loadAdventures()
        }}
      />
      <AdventureBoundary fallback={null}>
        <AdventureDetailSheet
          adventure={selectedAdventure}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedAdventure(null)
            }
          }}
        />
      </AdventureBoundary>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <HomeScreen />
      <Toaster theme="dark" position="top-center" richColors />
    </AuthProvider>
  )
}
