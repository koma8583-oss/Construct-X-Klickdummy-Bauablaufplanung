import { Link } from 'wouter';
import { Radio, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function NotFoundPage() {
  return (
    <div className="min-h-[100dvh] w-full flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 p-4">
      <div className="text-center space-y-6 max-w-md">
        <div className="flex justify-center">
          <div className="w-16 h-16 bg-primary/10 rounded-xl flex items-center justify-center">
            <Radio className="text-primary" size={32} />
          </div>
        </div>
        <div className="space-y-2">
          <h1 className="text-6xl font-bold text-foreground">404</h1>
          <h2 className="text-2xl font-semibold text-foreground">Seite nicht gefunden</h2>
          <p className="text-muted-foreground">
            Die angeforderte Seite existiert nicht oder wurde verschoben.
          </p>
        </div>
        <Link href="/">
          <Button className="gap-2" data-testid="button-home">
            <Home size={16} />
            Zurück zum Dashboard
          </Button>
        </Link>
      </div>
    </div>
  );
}
