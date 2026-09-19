import { useState, type FormEvent } from 'react'
import { Loader2, ShieldCheck, Trash2, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/context/AuthContext'
import { ApiError, type UserGender } from '@/services/api'

const GENDER_OPTIONS: { value: UserGender | null; label: string }[] = [
  { value: 'male', label: 'Мужской' },
  { value: 'female', label: 'Женский' },
  { value: 'other', label: 'Другой' },
  { value: null, label: 'Не указан' },
]

interface ProfileForm {
  name: string
  telegram_username: string
  birth_date: string
  gender: UserGender | null
}

const EMPTY_FORM: ProfileForm = { name: '', telegram_username: '', birth_date: '', gender: null }

interface ProfileModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ProfileModal({ open, onOpenChange }: ProfileModalProps) {
  const { user, isMaster, updateProfile, deleteAccount } = useAuth()
  const [form, setForm] = useState<ProfileForm>(EMPTY_FORM)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen && user) {
      // при каждом открытии показываем актуальные данные профиля
      setForm({
        name: user.name,
        telegram_username: user.telegram_username ?? '',
        birth_date: user.birth_date ?? '',
        gender: user.gender,
      })
      setIsSaving(false)
      setIsDeleting(false)
    }
    onOpenChange(nextOpen)
  }

  if (!user) {
    return null
  }

  const initials = user.name.trim().charAt(0).toUpperCase() || '?'

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSaving(true)
    try {
      await updateProfile({
        name: form.name.trim(),
        telegram_username: form.telegram_username.trim() || null,
        birth_date: form.birth_date || null,
        gender: form.gender,
      })
      toast.success('Профиль обновлён')
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Не удалось сохранить профиль')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete() {
    setIsDeleting(true)
    try {
      await deleteAccount()
      toast.success('Аккаунт удалён. Возвращайтесь за новыми приключениями!')
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Не удалось удалить аккаунт')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90svh] w-[calc(100vw-1.5rem)] max-w-md overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <Avatar size="lg">
              <AvatarImage src={user.avatar_url ?? undefined} alt={user.name} />
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 space-y-1">
              <DialogTitle className="truncate">{user.name}</DialogTitle>
              <DialogDescription className="truncate">{user.email}</DialogDescription>
              <Badge variant={isMaster ? 'default' : 'secondary'}>
                {isMaster ? <ShieldCheck /> : <UserRound />}
                {isMaster ? 'Мастер игры' : 'Игрок'}
              </Badge>
            </div>
          </div>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="profile-name">Имя</Label>
            <Input
              id="profile-name"
              required
              maxLength={64}
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="profile-telegram">Telegram</Label>
            <Input
              id="profile-telegram"
              placeholder="@nickname"
              value={form.telegram_username}
              onChange={(event) => setForm((current) => ({ ...current, telegram_username: event.target.value }))}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="profile-birth-date">Дата рождения</Label>
            <Input
              id="profile-birth-date"
              type="date"
              value={form.birth_date}
              onChange={(event) => setForm((current) => ({ ...current, birth_date: event.target.value }))}
            />
          </div>

          <div className="grid gap-2">
            <Label>Пол</Label>
            <div className="flex flex-wrap gap-2">
              {GENDER_OPTIONS.map((option) => (
                <Button
                  key={option.label}
                  type="button"
                  size="sm"
                  variant={form.gender === option.value ? 'default' : 'outline'}
                  onClick={() => setForm((current) => ({ ...current, gender: option.value }))}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="destructive" size="lg" disabled={isDeleting || isSaving}>
                  <Trash2 />
                  Удалить аккаунт
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Удалить аккаунт?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Профиль, персонажи и история приключений исчезнут безвозвратно. Это действие нельзя отменить.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Отмена</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={handleDelete} disabled={isDeleting}>
                    Удалить
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Button type="submit" size="lg" disabled={isSaving || isDeleting}>
              {isSaving ? <Loader2 className="size-4 animate-spin" /> : null}
              Сохранить
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
