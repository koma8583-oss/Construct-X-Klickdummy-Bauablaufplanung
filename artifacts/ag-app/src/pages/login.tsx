import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Link, useLocation } from 'wouter';
import { useAuth } from '@/contexts/auth-context';
import { useTranslation } from 'react-i18next';
import { Hexagon, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function Login() {
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const sessionExpired = new URLSearchParams(window.location.search).get('session_expired') === '1';
  const wrongRole = new URLSearchParams(window.location.search).get('wrong_role') === '1';

  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginForm) => {
    setIsLoading(true);
    try {
      await login(data.email, data.password);
      setLocation('/');
    } catch (error) {
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : 'Login failed',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex bg-background">
      <div className="flex-1 flex flex-col justify-center px-4 sm:px-6 lg:px-20 xl:px-24">
        <div className="mx-auto w-full max-w-sm lg:w-96">
          <div className="flex items-center gap-3 mb-8">
            <Hexagon className="w-8 h-8 text-primary fill-primary/20" />
            <div>
              <div className="font-bold text-lg tracking-tight text-foreground leading-tight">
                Construct-X Lean Construction Scheduling
              </div>
              <div className="text-[10px] text-primary uppercase font-bold tracking-widest">
                General Contractor
              </div>
            </div>
          </div>

          <h2 className="mt-8 text-2xl font-bold tracking-tight text-foreground">
            {t('login.title')}
          </h2>

          {wrongRole && (
            <div className="mt-4 p-3 bg-destructive/10 border border-destructive/30 rounded-md text-sm text-destructive">
              Dieses Konto ist ein Nachunternehmer-Konto. Bitte melden Sie sich in der Nachunternehmer-App an.
            </div>
          )}

          {sessionExpired && !wrongRole && (
            <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-md text-sm text-amber-700 dark:text-amber-400">
              Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.
            </div>
          )}

          <div className="mt-8">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="email">{t('login.email')}</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="name@company.com"
                  {...register('email')}
                  className="bg-card border-card-border"
                />
                {errors.email && (
                  <p className="text-sm text-destructive">{errors.email.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">{t('login.password')}</Label>
                <Input
                  id="password"
                  type="password"
                  {...register('password')}
                  className="bg-card border-card-border"
                />
                {errors.password && (
                  <p className="text-sm text-destructive">{errors.password.message}</p>
                )}
              </div>

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('login.submit')}
              </Button>
            </form>

            <div className="mt-6 text-center text-sm">
              <span className="text-muted-foreground">{t('login.noAccount')} </span>
              <Link href="/register">
                <span className="text-primary hover:text-primary/90 font-medium cursor-pointer">
                  {t('login.register')}
                </span>
              </Link>
            </div>
          </div>
        </div>
      </div>
      
      <div className="hidden lg:block relative w-0 flex-1 bg-card border-l border-border">
        <div className="absolute inset-0 h-full w-full object-cover bg-[url('https://images.unsplash.com/photo-1541888086925-eb2c1f4e1987?q=80&w=2070&auto=format&fit=crop')] bg-cover bg-center opacity-30 mix-blend-luminosity"></div>
        <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent"></div>
        <div className="absolute bottom-12 left-12 right-12 text-foreground">
          <h3 className="text-2xl font-bold mb-2">Taktplanung für Auftraggeber</h3>
          <p className="text-muted-foreground max-w-lg">Erstellen Sie Projekte, vergeben Sie Takte und koordinieren Sie Ihre Nachunternehmer an einem Ort.</p>
        </div>
      </div>
    </div>
  );
}
