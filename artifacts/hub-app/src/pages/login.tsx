import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Radio } from 'lucide-react';
import { useAuth } from '@/contexts/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const sessionExpired = new URLSearchParams(window.location.search).get('session_expired') === '1';
  const [error, setError] = useState(
    sessionExpired ? 'Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.' : ''
  );
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await login(email, password);
      setLocation('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] w-full flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="w-14 h-14 bg-primary rounded-xl flex items-center justify-center">
              <Radio className="text-primary-foreground" size={28} />
            </div>
          </div>
          <div>
            <CardTitle className="text-2xl font-bold">
              TaktKoord <span className="text-primary">/</span> KOORDINATION
            </CardTitle>
            <CardDescription className="mt-2">
              Melden Sie sich an, um fortzufahren
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">E-Mail</Label>
              <Input
                id="email"
                type="email"
                placeholder="max@beispiel.de"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                data-testid="input-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Passwort</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                data-testid="input-password"
              />
            </div>

            {error && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive" data-testid="text-error">
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={isLoading}
              data-testid="button-submit"
            >
              {isLoading ? 'Anmelden...' : 'Anmelden'}
            </Button>

            <div className="text-center text-sm text-muted-foreground">
              Noch kein Konto?{' '}
              <Link href="/register" className="text-primary hover:underline" data-testid="link-register">
                Registrieren
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
