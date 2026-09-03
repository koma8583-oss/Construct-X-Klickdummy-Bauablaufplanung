import { useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Inbox,
  Lock,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  getListAnProjectInvitationsQueryKey,
  type AnProjectInvitation,
  useAcceptAnProjectInvitation,
  useListAnProjectInvitations,
  useRejectAnProjectInvitation,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

function dateText(value?: string | null) {
  if (!value) return "Nicht veröffentlicht";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Nicht veröffentlicht" : date.toLocaleDateString("de-DE");
}

function policyText(policy: Record<string, unknown>, key: string): string | null {
  const value = policy[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function policyList(policy: Record<string, unknown>, key: string): string[] {
  const value = policy[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value as string[] : [];
}

function InvitationCard({ invitation }: { invitation: AnProjectInvitation }) {
  const [confirmed, setConfirmed] = useState(false);
  const { toast } = useToast();
  const client = useQueryClient();
  const accept = useAcceptAnProjectInvitation();
  const reject = useRejectAnProjectInvitation();
  const busy = accept.isPending || reject.isPending;
  const policy = (invitation.policySnapshot ?? {}) as Record<string, unknown>;
  const policyName = policyText(policy, "name") ?? "Nutzungsrichtlinie";
  const permissions = policyList(policy, "permissions");
  const prohibitions = policyList(policy, "prohibitions");

  const decide = async (kind: "accept" | "reject") => {
    try {
      if (kind === "accept") await accept.mutateAsync({ id: invitation.id, data: { policyAccepted: true } });
      else await reject.mutateAsync({ id: invitation.id, data: {} });
      await client.invalidateQueries({ queryKey: getListAnProjectInvitationsQueryKey() });
      toast({ title: kind === "accept" ? "Projektzugang angenommen" : "Projekteinladung abgelehnt" });
    } catch {
      toast({ title: "Aktion konnte nicht ausgeführt werden", description: "Bitte versuchen Sie es erneut.", variant: "destructive" });
    }
  };

  return (
    <article data-testid={`card-invitation-${invitation.id}`} className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="absolute inset-y-0 left-0 w-1 bg-accent" />
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/25 text-primary"><Building2 className="h-5 w-5" /></span>
          <div className="min-w-0">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Projektzugang</p>
            <h2 className="mt-1 line-clamp-2 break-words text-lg font-semibold">{invitation.projectName || "Projektname nicht veröffentlicht"}</h2>
            <p className="mt-1 text-xs text-muted-foreground">Von {invitation.senderAgOrgName ?? "Auftraggebername nicht veröffentlicht"} · {dateText(invitation.createdAt)}</p>
          </div>
        </div>
        <Badge variant="outline" className={invitation.status === "PENDING" ? "border-amber-600/30 bg-amber-500/10 text-amber-800" : "border-border text-muted-foreground"}>
          {invitation.status === "PENDING" ? "Offen" : invitation.status === "ACCEPTED" ? "Angenommen" : "Abgelehnt"}
        </Badge>
      </div>
      <div className="mt-5 space-y-2 rounded-xl border bg-muted/20 p-3 text-sm">
        <div className="flex items-center gap-2 font-medium"><Building2 className="h-4 w-4 text-primary" />Projektzugang</div>
        <p><span className="text-muted-foreground">Projekt:</span> {invitation.projectName || "Projektname nicht veröffentlicht"}</p>
        {invitation.projectLocation && <p><span className="text-muted-foreground">Ort:</span> {invitation.projectLocation}</p>}
        {invitation.projectDescription && <p>{invitation.projectDescription}</p>}
      </div>
      <div className="mt-4 space-y-2 rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm">
        <div className="flex items-center gap-2 font-medium"><Lock className="h-4 w-4 text-primary" />Policy-Vorschau</div>
      </div>
      <div className="mt-4 space-y-2 rounded-xl border p-3 text-sm">
        <div className="flex items-center gap-2 font-medium"><ShieldCheck className="h-4 w-4 text-primary" /><span>{policyName}</span></div>
        {permissions.length > 0 && <p><strong>Erlaubt:</strong> {permissions.join(", ")}</p>}
        {prohibitions.length > 0 && <p><strong>Nicht erlaubt:</strong> {prohibitions.join(", ")}</p>}
      </div>
      {invitation.status === "PENDING" ? (
        <div className="mt-5 space-y-4">
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-background/60 p-3 text-sm">
            <Checkbox data-testid={`checkbox-policy-${invitation.id}`} checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} />
            <span>Ich bestätige die angezeigte Policy-Vorschau. Die Projektmitgliedschaft wird erst nach meiner ausdrücklichen Annahme aktiviert.</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button data-testid={`button-accept-invitation-${invitation.id}`} disabled={!confirmed || busy} onClick={() => void decide("accept")}><Check className="mr-2 h-4 w-4" />Projektzugang annehmen</Button>
            <Button data-testid={`button-reject-invitation-${invitation.id}`} variant="outline" disabled={busy} onClick={() => void decide("reject")}><X className="mr-2 h-4 w-4" />Ablehnen</Button>
          </div>
        </div>
      ) : invitation.status === "ACCEPTED" ? (
        <div className="mt-5 rounded-xl border border-emerald-700/20 bg-emerald-600/10 p-3 text-sm text-emerald-900 dark:text-emerald-200">
          <p className="font-semibold">Projektmitgliedschaft ist aktiv</p>
          <p className="mt-1 leading-relaxed">Neue Leistungsfreigaben erscheinen separat im Datenraum.</p>
          <Link href="/data-room" className="mt-2 inline-flex items-center gap-1 font-medium text-primary hover:underline">Datenraum öffnen <ArrowRight className="h-3.5 w-3.5" /></Link>
        </div>
      ) : <p className="mt-5 text-sm text-muted-foreground">Projektzugang abgelehnt. Leistungsfreigaben bleiben für dieses Projekt gesperrt.</p>}
    </article>
  );
}

export default function ProjectInvitationsPage() {
  const query = useListAnProjectInvitations({ query: { queryKey: getListAnProjectInvitationsQueryKey(), refetchInterval: 15000, refetchIntervalInBackground: false } });
  const invitations = Array.isArray(query.data) ? query.data : [];
  const openInvitations = invitations.filter((invitation) => invitation.status === "PENDING");

  if (query.isLoading) return <main className="mx-auto max-w-4xl space-y-6 p-5 lg:p-8"><Skeleton className="h-10 w-80" /><Skeleton className="h-96 w-full" /></main>;
  if (query.isError) return <main className="mx-auto flex min-h-[60dvh] max-w-lg flex-col items-center justify-center gap-4 p-6 text-center"><Inbox className="h-10 w-10 text-destructive" /><h1 className="text-lg font-semibold">Projektzugang konnte nicht geladen werden</h1><Button variant="outline" onClick={() => void query.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Erneut laden</Button></main>;

  return (
    <main className="mx-auto w-full max-w-5xl space-y-7 p-5 pb-12 lg:p-8">
      <div><Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Zum Dashboard</Link><p className="mt-6 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-primary">AN / ADMINISTRATION</p><h1 data-testid="text-project-invitations-title" className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Projektzugang</h1><p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">Projekteinladungen gehören zur Administration. Nach Ihrer Entscheidung verschwindet eine offene Einladung aus diesem Bereich.</p></div>
      {openInvitations.length === 0 ? <div data-testid="empty-project-invitations" className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center"><Check className="h-10 w-10 text-emerald-600" /><h2 className="mt-4 text-lg font-semibold">Keine offenen Projekteinladungen</h2><p className="mt-2 text-sm text-muted-foreground">Aktuell ist keine administrative Entscheidung offen.</p></div> : <div className="grid gap-5 lg:grid-cols-2">{openInvitations.map((invitation) => <InvitationCard key={invitation.id} invitation={invitation} />)}</div>}
    </main>
  );
}