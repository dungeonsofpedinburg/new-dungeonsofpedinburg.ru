import { Dices, LogIn, LogOut, Sparkles, UserRound } from 'lucide-react'
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

interface HeaderProps {
  /** Открыть модалку входа/регистрации. */
  onRequestAuth: () => void
  /** Открыть модалку профиля. */
  onRequestProfile: () => void
}

export function Header({ onRequestAuth, onRequestProfile }: HeaderProps) {
  const { user, isAuthenticated, isMaster, logout } = useAuth()
  const initials = user && user.name.trim() ? user.name.trim().charAt(0).toUpperCase() : '?'

  function handleLogout() {
    logout()
    toast.success('Вы вышли из аккаунта')
  }

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between gap-3 px-4">
        <a href="#/" className="flex min-w-0 items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <Dices className="size-4" />
          </span>
          <span className="truncate font-heading text-sm font-semibold sm:text-base">Подземелья Пединбурга</span>
        </a>

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
                <DropdownMenuItem onSelect={() => toast.info('Конструктор приключений появится в следующем обновлении')}>
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
          <Button size="sm" onClick={onRequestAuth}>
            <LogIn />
            Войти
          </Button>
        )}
      </div>
    </header>
  )
}
