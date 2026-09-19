import { Dices, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

function App() {
  return (
    // Тема проекта — всегда dark, класс вешаем на корневой контейнер.
    <div className="dark">
      <main className="flex min-h-svh w-full items-center justify-center bg-background px-4 py-8 text-foreground">
        <Card className="w-full max-w-sm">
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
              React, Vite и TypeScript собраны воедино. Tailwind CSS v4, shadcn/ui,
              Lucide и HashRouter готовы к разработке приключений.
            </p>
          </CardContent>

          <CardFooter>
            <Button className="w-full" size="lg">
              <Sparkles data-icon="inline-start" />
              Начать приключение
            </Button>
          </CardFooter>
        </Card>
      </main>
    </div>
  )
}

export default App
