import { ReactNode } from "react";
import { useAuth } from "@/contexts/auth";
import { Redirect } from "wouter";
import { Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AuthGuard({ children }: { children: ReactNode }) {
  const { user, isLoading, logout } = useAuth();

  if (isLoading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  // AN-App is only for AN (Nachunternehmen) accounts
  if (user.orgType !== "AN") {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-background gap-4 p-6 text-center">
        <ShieldAlert className="h-12 w-12 text-destructive" />
        <h1 className="text-xl font-semibold">Falsches Konto</h1>
        <p className="text-muted-foreground max-w-sm text-sm">
          Sie sind als <strong>{user.orgName}</strong> (Auftraggeber) angemeldet.
          Die Nachunternehmen-App ist nur für AN-Konten zugänglich.
        </p>
        <Button variant="outline" onClick={() => logout()}>
          Abmelden und neu einloggen
        </Button>
      </div>
    );
  }

  return <>{children}</>;
}
