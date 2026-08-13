import { useState } from "react";
import { useAuth } from "@/contexts/auth";
import { Link, Redirect, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslation } from "react-i18next";
import { Hexagon, Loader2 } from "lucide-react";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const sessionExpired = new URLSearchParams(window.location.search).get("session_expired") === "1";
  const wrongRole = new URLSearchParams(window.location.search).get("wrong_role") === "1";
  const [error, setError] = useState(
    wrongRole
      ? "Dieses Konto ist ein Auftraggeber-Konto. Bitte melden Sie sich in der Auftraggeber-App an."
      : sessionExpired
      ? "Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an."
      : ""
  );
  const { login, user, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (user) {
    return <Redirect to="/" />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await login({ email, password });
      setLocation("/");
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
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
                Subcontractor
              </div>
            </div>
          </div>

          <h2 className="mt-8 text-2xl font-bold tracking-tight text-foreground">
            {t("auth.login")}
          </h2>

          {error && (
            <div className="mt-4 p-3 bg-destructive/10 border border-destructive/30 rounded-md text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="mt-8">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="email">{t("auth.email")}</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-card border-card-border"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">{t("auth.password")}</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-card border-card-border"
                />
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t("auth.login")}
              </Button>
            </form>

            <div className="mt-6 text-center text-sm">
              <span className="text-muted-foreground">{t("auth.noAccount")} </span>
              <Link href="/register">
                <span className="text-primary hover:text-primary/90 font-medium cursor-pointer">
                  {t("auth.register")}
                </span>
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="hidden lg:block relative w-0 flex-1 bg-card border-l border-border">
        <div className="absolute inset-0 h-full w-full object-cover bg-[url('https://images.unsplash.com/photo-1504307651254-35680f356dfd?q=80&w=2070&auto=format&fit=crop')] bg-cover bg-center opacity-30 mix-blend-luminosity"></div>
        <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent"></div>
        <div className="absolute bottom-12 left-12 right-12 text-foreground">
          <h3 className="text-2xl font-bold mb-2">Ressourcen optimal einplanen</h3>
          <p className="text-muted-foreground max-w-lg">Verwalten Sie Anfragen, prüfen Sie Ihre Kapazitäten und koordinieren Sie Ihre Einsätze an einem Ort.</p>
        </div>
      </div>
    </div>
  );
}
