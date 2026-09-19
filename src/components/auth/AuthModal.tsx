import { useState, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/context/AuthContext'
import { ApiError } from '@/services/api'

const EMPTY_LOGIN = { email: '', password: '' }
const EMPTY_REGISTER = { name: '', email: '', password: '', telegram: '', masterCode: '' }

interface AuthModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message
  }
  return 'Что-то пошло не так. Попробуйте ещё раз.'
}

export function AuthModal({ open, onOpenChange }: AuthModalProps) {
  const { login, register } = useAuth()
  const [tab, setTab] = useState<'login' | 'register'>('login')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [loginForm, setLoginForm] = useState(EMPTY_LOGIN)
  const [registerForm, setRegisterForm] = useState(EMPTY_REGISTER)

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      // при каждом открытии показываем чистые формы
      setTab('login')
      setLoginForm(EMPTY_LOGIN)
      setRegisterForm(EMPTY_REGISTER)
      setIsSubmitting(false)
    }
    onOpenChange(nextOpen)
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    try {
      const user = await login(loginForm)
      toast.success(`С возвращением, ${user.name}!`)
      onOpenChange(false)
    } catch (error) {
      toast.error(describeError(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    try {
      const user = await register({
        name: registerForm.name,
        email: registerForm.email,
        password: registerForm.password,
        telegram_username: registerForm.telegram,
        master_code: registerForm.masterCode,
      })
      toast.success(
        user.role === 'master' ? `Добро пожаловать в подземелья, Мастер ${user.name}!` : `Добро пожаловать, ${user.name}!`,
      )
      onOpenChange(false)
    } catch (error) {
      toast.error(describeError(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90svh] w-[calc(100vw-1.5rem)] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{tab === 'login' ? 'Вход в таверну' : 'Карточка нового героя'}</DialogTitle>
          <DialogDescription>
            {tab === 'login'
              ? 'Введите email и пароль, чтобы вернуться к приключениям.'
              : 'Достаточно имени, email и пароля — остальное можно заполнить позже.'}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(value) => setTab(value === 'register' ? 'register' : 'login')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login">Вход</TabsTrigger>
            <TabsTrigger value="register">Регистрация</TabsTrigger>
          </TabsList>

          <TabsContent value="login">
            <form className="grid gap-4 pt-2" onSubmit={handleLogin}>
              <div className="grid gap-2">
                <Label htmlFor="login-email">Email</Label>
                <Input
                  id="login-email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="hero@example.com"
                  value={loginForm.email}
                  onChange={(event) => setLoginForm((form) => ({ ...form, email: event.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="login-password">Пароль</Label>
                <Input
                  id="login-password"
                  type="password"
                  required
                  autoComplete="current-password"
                  placeholder="••••••"
                  value={loginForm.password}
                  onChange={(event) => setLoginForm((form) => ({ ...form, password: event.target.value }))}
                />
              </div>
              <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
                Войти
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="register">
            <form className="grid gap-4 pt-2" onSubmit={handleRegister}>
              <div className="grid gap-2">
                <Label htmlFor="register-name">Имя</Label>
                <Input
                  id="register-name"
                  required
                  maxLength={64}
                  autoComplete="nickname"
                  placeholder="Гром"
                  value={registerForm.name}
                  onChange={(event) => setRegisterForm((form) => ({ ...form, name: event.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="register-email">Email</Label>
                <Input
                  id="register-email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="hero@example.com"
                  value={registerForm.email}
                  onChange={(event) => setRegisterForm((form) => ({ ...form, email: event.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="register-password">Пароль</Label>
                <Input
                  id="register-password"
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  placeholder="Минимум 6 символов"
                  value={registerForm.password}
                  onChange={(event) => setRegisterForm((form) => ({ ...form, password: event.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="register-telegram">
                  Telegram <span className="text-muted-foreground">(необязательно)</span>
                </Label>
                <Input
                  id="register-telegram"
                  placeholder="@nickname"
                  value={registerForm.telegram}
                  onChange={(event) => setRegisterForm((form) => ({ ...form, telegram: event.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="register-master-code">Код Мастера игры</Label>
                <Input
                  id="register-master-code"
                  placeholder="Например, DUNGEON-MASTER"
                  value={registerForm.masterCode}
                  onChange={(event) => setRegisterForm((form) => ({ ...form, masterCode: event.target.value }))}
                />
                <p className="text-xs text-muted-foreground">Оставьте пустым, если вы обычный игрок.</p>
              </div>
              <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
                Создать аккаунт
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
