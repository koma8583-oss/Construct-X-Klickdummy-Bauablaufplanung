import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Radio, Briefcase, Hammer } from 'lucide-react';
import { useAuth } from '@/contexts/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { HubRole } from '@/lib/api';

export default function RegisterPage() {
  const [, setLocation] = useLocation();
  const { register } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'AG' | 'AN'>('AG');
  const [companyName, setCompanyName] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const roles: Array<{ value: 'AG' | 'AN'; label: string; description: string; icon: typeof Briefcase }> = [
    {
      value: 'AG',
      label: 'Auftraggeber (AG)',
      description: 'Generalunternehmer, plant Projekte und Leistungen',
      icon: Briefcase,
    },
    {
      value: 'AN',
      label: 'Nachunternehmer (AN)',
      description: 'Empfängt und beantwortet Arbeitsanfragen',
      icon: Hammer,
    },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await register({
        name,
        email,
        password,
        role,
        companyName,
      });
      setLocation('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registrierung fehlgeschlagen');
    } finally {
      setIsLoading(false);
    }
  };

  const showCompanyField = true;

  return (
    <div className="min-h-[100dvh] w-full flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 p-4">
      <Card className="w-full max-w-xl">
        <CardHeader className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="w-14 h-14 bg-primary rounded-xl flex items-center justify-center">
              <Radio className="text-primary-foreground" size={28} />
            </div>
          </div>
          <div>
            <CardTitle className="text-2xl font-bold">
              Construct-X Leistung Coordination
            </CardTitle>
            <CardDescription className="mt-2">
              Erstellen Sie ein Konto
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                type="text"
                placeholder="Max Mustermann"
                value={name}
                onChange={e => setName(e.target.value)}
                required
                data-testid="input-name"
              />
            </div>

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

            <div className="space-y-3">
              <Label>Rolle</Label>
              <div className="grid gap-3">
                {roles.map(r => {
                  const Icon = r.icon;
                  const isSelected = role === r.value;
                  return (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => setRole(r.value)}
                      className={cn(
                        'flex items-start gap-3 p-4 rounded-lg border-2 transition-all text-left',
                        isSelected
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/50'
                      )}
                      data-testid={`button-role-${r.value.toLowerCase()}`}
                    >
                      <div
                        className={cn(
                          'w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0',
                          isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                        )}
                      >
                        <Icon size={20} />
                      </div>
                      <div className="flex-1">
                        <div className="font-medium text-sm">{r.label}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{r.description}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {showCompanyField && (
              <div className="space-y-2">
                <Label htmlFor="companyName">Firmenname</Label>
                <Input
                  id="companyName"
                  type="text"
                  placeholder="Muster GmbH"
                  value={companyName}
                  onChange={e => setCompanyName(e.target.value)}
                  required
                  data-testid="input-company"
                />
              </div>
            )}

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
              {isLoading ? 'Registrieren...' : 'Registrieren'}
            </Button>

            <div className="text-center text-sm text-muted-foreground">
              Bereits registriert?{' '}
              <Link href="/login" className="text-primary hover:underline" data-testid="link-login">
                Anmelden
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
