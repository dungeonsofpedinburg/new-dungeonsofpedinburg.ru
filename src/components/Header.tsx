import { useState } from 'react'
import { Dices, LogIn, LogOut, Send, Sparkles, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuth } from '@/context/AuthContext'

const COMMUNITY_URL = 'https://t.me/dungeonsofpedinburg'

const ACTIVE_TAB_CLASSES =
  'cursor-pointer border-b-2 border-pink-600 pb-1 text-xs font-bold tracking-wider text-white uppercase transition-colors sm:text-sm'
const INACTIVE_TAB_CLASSES =
  'cursor-pointer border-b-2 border-transparent pb-1 text-xs font-bold tracking-wider text-zinc-400 uppercase transition-colors hover:text-white sm:text-sm'

interface HeaderProps {
  /** Открыть модалку входа/регистрации. */
  onRequestAuth: () => void
  /** Открыть модалку профиля. */
  onRequestProfile: () => void
  /** Открыть визард создания приключения (только Мастер). */
  onRequestCreateAdventure: () => void
}

export function Header({ onRequestAuth, onRequestProfile, onRequestCreateAdventure }: HeaderProps) {
  const { user, isAuthenticated, isMaster, logout } = useAuth()
  const [activeTab, setActiveTab] = useState<'games' | 'updates'>('games')
  const initials = user && user.name.trim() ? user.name.trim().charAt(0).toUpperCase() : '?'

  function handleLogout() {
    logout()
    toast.success('Вы вышли из аккаунта')
  }

  function handleUpdatesTab() {
    toast.info('Раздел «Обновления» появится в следующем релизе')
  }

  return (
    <header className="sticky top-0 z-40 w-full border-b border-zinc-800 bg-black/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        <a href="#/" className="flex shrink-0 items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#ec4899]/15 text-[#ec4899]">
            <Dices className="size-4" />
          </span>
          <span className="font-heading text-sm font-black tracking-wide text-white uppercase sm:text-base">
            Подземелья Пединбурга
          </span>
        </a>

        <nav className="order-3 flex w-full items-center gap-5 sm:order-none sm:w-auto">
          <button
            type="button"
            onClick={() => setActiveTab('games')}
            className={activeTab === 'games' ? ACTIVE_TAB_CLASSES : INACTIVE_TAB_CLASSES}
          >
            Список игр
          </button>
          <button type="button" onClick={handleUpdatesTab} className={INACTIVE_TAB_CLASSES}>
            Обновления
          </button>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Button
            asChild
            size="sm"
            variant="outline"
            className="border-zinc-700 text-[11px] font-bold tracking-wider text-zinc-200 uppercase hover:bg-zinc-800 hover:text-white"
          >
            <a href={COMMUNITY_URL} target="_blank" rel="noreferrer">
              <Send className="size-3.5" />
              <span className="hidden sm:inline">Вступить в сообщество</span>
              <span className="sm:hidden">Сообщество</span>
            </a>
          </Button>

          {isAuthenticated && user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2 pl-1">
                  <Avatar size="sm">
                    <AvatarImage src={user.avatar_url ?? undefined} alt={user.name} />
                    <AvatarFallback>{initials}</AvatarFallback>
                  </Avatar>
                  <span className="hidden max-w-28 truncate sm:inline">{user.name}</span>
                  <Badge variant={isMaster ? 'default' : 'secondary'}>{isMaster ? 'Мастер' : 'Игрок'}</Badge>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <span className="block truncate">{user.name}</span>
                  <span className="block truncate text-xs font-normal text-muted-foreground">{user.email}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onRequestProfile}>
                  <UserRound />
                  Мой профиль
                </DropdownMenuItem>
                {isMaster ? (
                  <DropdownMenuItem onSelect={onRequestCreateAdventure}>
                    <Sparkles />
                    Создать приключение
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={handleLogout}>
                  <LogOut />
                  Выйти
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              size="sm"
              onClick={onRequestAuth}
              className="cursor-pointer font-bold tracking-wider uppercase"
            >
              <LogIn />
              Войти
            </Button>
          )}
        </div>
      </div>
    </header>
  )
}
