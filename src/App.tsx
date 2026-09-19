import { useState } from 'react'
import { Dices, Loader2, LogIn, RefreshCcw, Sparkles, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { AuthModal } from '@/components/auth/AuthModal'
import { Header } from '@/components/Header'
import { ProfileModal } from '@/components/profile/ProfileModal'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Toaster } from '@/components/ui/sonner'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import { ApiError, api } from '@/services/api'

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-medium">{value}</span>
    </div>
  )
}

function LoadingCard() {
  return (
    <Card className="w-full max-w-sm">
      <CardContent className="flex items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Проверяем вход…
      </CardContent>
    </Card>
  )
}

function HeroGreetingCard({ onOpenProfile }: { onOpenProfile: () => void }) {
  const { user, isMaster } = useAuth()

  if (!user) {
    return null
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <Dices className="size-5" />
          </span>
          <Badge variant={isMaster ? 'default' : 'secondary'}>
            {isMaster ? <Sparkles /> : <UserRound />}
            {isMaster ? 'Мастер игры' : 'Игрок'}
          </Badge>
        </div>
        <CardTitle className="text-lg">Привет, {user.name}!</CardTitle>
        <CardDescription>Авторизация и профиль работают — можно собирать команду за столом.</CardDescription>
      </CardHeader>

      <CardContent className="grid gap-2 text-sm">
        <InfoRow label="Роль" value={isMaster ? 'Мастер игры' : 'Игрок'} />
        <InfoRow label="Email" value={user.email} />
        <InfoRow label="Telegram" value={user.telegram_username ? `@${user.telegram_username}` : '—'} />
        <InfoRow label="Дата рождения" value={user.birth_date ?? '—'} />
      </CardContent>

      <CardFooter>
        <Button variant="outline" size="lg" className="w-full" onClick={onOpenProfile}>
          <UserRound />
          Мой профиль
        </Button>
      </CardFooter>
    </Card>
  )
}

function GuestCard({ onRequestAuth }: { onRequestAuth: () => void }) {
  const [isPinging, setIsPinging] = useState(false)

  async function handlePing() {
    setIsPinging(true)
    try {
      const response = await api.ping()
      toast.success(`API отвечает: ${response.status}`)
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'API недоступен')
    } finally {
      setIsPinging(false)
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <Dices className="size-5" />
          </span>
          <Badge variant="secondary">v1.0 MVP</Badge>
        </div>
        <CardTitle className="text-lg">Подземелья Пединбурга</CardTitle>
        <CardDescription>Тех-фундамент развернут успешно</CardDescription>
      </CardHeader>

      <CardContent>
        <p className="text-muted-foreground">
          Войдите или зарегистрируйтесь, чтобы сохранять героев, участие в играх и приглашения за стол.
        </p>
      </CardContent>

      <CardFooter className="flex-col gap-2 sm:flex-row">
        <Button size="lg" className="w-full" onClick={onRequestAuth}>
          <LogIn />
          Войти или зарегистрироваться
        </Button>
        <Button variant="ghost" size="lg" className="w-full sm:w-auto" onClick={handlePing} disabled={isPinging}>
          {isPinging ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
          Проверить API
        </Button>
      </CardFooter>
    </Card>
  )
}

function HomeScreen() {
  const { isLoading, isAuthenticated } = useAuth()
  const [isAuthOpen, setIsAuthOpen] = useState(false)
  const [isProfileOpen, setIsProfileOpen] = useState(false)

  return (
    // Тема проекта — всегда dark, класс вешаем на корневой контейнер.
    <div className="dark flex min-h-svh flex-col bg-background text-foreground">
      <Header onRequestAuth={() => setIsAuthOpen(true)} onRequestProfile={() => setIsProfileOpen(true)} />

      <main className="flex flex-1 items-center justify-center px-4 py-8">
        {isLoading ? (
          <LoadingCard />
        ) : isAuthenticated ? (
          <HeroGreetingCard onOpenProfile={() => setIsProfileOpen(true)} />
        ) : (
          <GuestCard onRequestAuth={() => setIsAuthOpen(true)} />
        )}
      </main>

      <AuthModal open={isAuthOpen} onOpenChange={setIsAuthOpen} />
      <ProfileModal open={isProfileOpen} onOpenChange={setIsProfileOpen} />
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

