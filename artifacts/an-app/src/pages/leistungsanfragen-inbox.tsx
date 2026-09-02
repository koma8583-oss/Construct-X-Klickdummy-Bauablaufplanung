import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { format, differenceInHours } from "date-fns";
import { de } from "date-fns/locale";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  Inbox,
  Lock,
  MapPin,
  RefreshCw,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import {
  getListAnLeistungsanfragenQueryKey,
  getListAnProjectInvitationsQueryKey,
  type AnLeistungsanfrageListItem,
  type AnLeistungsanfrageListItemStatus,
  type AnProjectInvitation,
  useAcceptAnProjectInvitation,
  useListAnLeistungsanfragen,
  useListAnProjectInvitations,
  useRejectAnProjectInvitation,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

const STATUS_LABELS: Record<AnLeistungsanfrageListItemStatus, string> = {
  RECEIVED: "Eingegangen",
  DETAILS_RETRIEVED: "Daten abgerufen",
  UNDER_REVIEW: "In Prüfung",
  RESPONDED: "Beantwortet",
  REVISION_REQUIRED: "Überarbeitung angefragt",
  CONFIRMED: "Bestätigt",
  CANCELLED: "Storniert",
  SUPERSEDED: "Ersetzt",
};

const STATUS_TONE: Record<AnLeistungsanfrageListItemStatus, string> = {
  RECEIVED: "border-cyan-700/20 bg-cyan-700/10 text-cyan-800 dark:text-cyan-200",
  DETAILS_RETRIEVED: "border-amber-600/20 bg-amber-500/10 text-amber-800 dark:text-amber-200",
  UNDER_REVIEW: "border-amber-600/20 bg-amber-500/10 text-amber-800 dark:text-amber-200",
  RESPONDED: "border-slate-500/20 bg-slate-500/10 text-slate-700 dark:text-slate-200",
  REVISION_REQUIRED: "border-orange-600/20 bg-orange-500/10 text-orange-800 dark:text-orange-200",
  CONFIRMED: "border-emerald-700/20 bg-emerald-600/10 text-emerald-800 dark:text-emerald-200",
  CANCELLED: "border-slate-500/20 bg-slate-500/10 text-slate-600 dark:text-slate-300",
  SUPERSEDED: "border-slate-500/20 bg-slate-500/10 text-slate-600 dark:text-slate-300",
};

type ViewFilter = "OPEN" | "WAITING" | "DONE";

function dateText(value?: string | null, withTime = false) {
  if (!value) return "Nicht veröffentlicht";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Nicht veröffentlicht";
  return format(parsed, withTime ? "dd.MM.yyyy, HH:mm 'Uhr'" : "dd.MM.yyyy", { locale: de });
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function policyText(policy: Record<string, unknown>, key: string): string | null {
  const value = policy[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function policyList(policy: Record<string, unknown>, key: string): string[] {
  return isStringArray(policy[key]) ? policy[key] : [];
}

function deadline(item: AnLeistungsanfrageListItem) {
  if (!item.responseRequiredBy) return { label: "Keine Frist veröffentlicht", tone: "text-muted-foreground", urgent: false };
  const hours = differenceInHours(new Date(item.responseRequiredBy), new Date());
  if (hours < 0) return { label: "Antwortfrist abgelaufen", tone: "text-destructive", urgent: true };
  if (hours < 24) return { label: `Antwort in ${Math.max(1, hours)} Std. fällig`, tone: "text-destructive", urgent: true };
  if (hours < 72) return { label: "Antwortfrist läuft bald ab", tone: "text-amber-700 dark:text-amber-300", urgent: true };
  return { label: `Antwort bis ${dateText(item.responseRequiredBy, true)}`, tone: "text-foreground", urgent: false };
}

function isDone(status: AnLeistungsanfrageListItemStatus) {
  return ["CONFIRMED", "CANCELLED", "SUPERSEDED"].includes(status);
}

function isWaiting(status: AnLeistungsanfrageListItemStatus) {
  return status === "RESPONDED";
}

function isTodo(status: AnLeistungsanfrageListItemStatus) {
  return !isDone(status) && !isWaiting(status);
}

export type InboxItem =
  | { kind: "invitation"; data: AnProjectInvitation; receivedAt: string; isOpen: boolean }
  | { kind: "service-request"; data: AnLeistungsanfrageListItem & Record<string, unknown>; receivedAt: string; isOpen: boolean };

export interface InboxFilterState {
  inboxFilter: "ALL" | "OPEN" | "WAITING" | "DONE";
  deadlineFilter: "ALL" | "DUE_SOON" | "OVERDUE" | "EXPIRED";
  statusFilter: string;
  coordinationFilter: string;
  proposalFilter: string;
  actionOwnerFilter: string;
  scheduleFilter: string;
}

export function filterInboxItems(items: InboxItem[], filters: InboxFilterState) {
  const serviceFilterActive = [filters.deadlineFilter, filters.statusFilter, filters.coordinationFilter, filters.proposalFilter, filters.actionOwnerFilter, filters.scheduleFilter].some((filter) => filter !== "ALL");
  return items.filter((item) => {
    if (filters.inboxFilter === "OPEN" && item.kind === "service-request" && !isTodo(item.data.status)) return false;
    if (filters.inboxFilter === "WAITING" && item.kind === "service-request" && !isWaiting(item.data.status)) return false;
    if (filters.inboxFilter === "DONE" && item.kind === "service-request" && !isDone(item.data.status)) return false;
    if (filters.inboxFilter === "OPEN" && item.kind === "invitation" && !item.isOpen) return false;
    if (filters.inboxFilter === "WAITING" && item.kind === "invitation") return false;
    if (filters.inboxFilter === "DONE" && item.kind === "invitation" && item.isOpen) return false;
    if (item.kind === "invitation") return !serviceFilterActive;
    const request = item.data as Record<string, unknown>;
    if (filters.statusFilter !== "ALL" && request.status !== filters.statusFilter) return false;
    if (filters.coordinationFilter !== "ALL" && request.coordinationState !== filters.coordinationFilter) return false;
    if (filters.proposalFilter === "OPEN" && !request.openProposal) return false;
    if (filters.proposalFilter === "NONE" && request.openProposal) return false;
    if (filters.actionOwnerFilter !== "ALL" && filters.actionOwnerFilter !== request.nextActionOwner && !(filters.actionOwnerFilter === "NONE" && !request.nextActionOwner)) return false;
    const delta = request.scheduleDelta as { hasChange?: boolean } | undefined;
    if (filters.scheduleFilter === "CHANGED" && !delta?.hasChange) return false;
    if (filters.scheduleFilter === "UNCHANGED" && delta?.hasChange) return false;
    if (filters.deadlineFilter !== "ALL") {
      const due = request.responseRequiredBy ? new Date(String(request.responseRequiredBy)) : null;
      const expired = request.status === "EXPIRED" || (!!due && due.getTime() < Date.now());
      if (filters.deadlineFilter === "EXPIRED" && !expired) return false;
      if (filters.deadlineFilter === "OVERDUE" && (!expired || request.status === "EXPIRED")) return false;
      if (filters.deadlineFilter === "DUE_SOON" && (!due || due.getTime() < Date.now() || due.getTime() - Date.now() > 48 * 60 * 60 * 1000)) return false;
    }
    return true;
  });
}

function StatusBadge({ status }: { status: AnLeistungsanfrageListItemStatus }) {
  return (
    <Badge data-testid={`status-request-${status}`} variant="outline" className={`font-medium ${STATUS_TONE[status]}`}>
      {STATUS_LABELS[status]}
    </Badge>
  );
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
  const policyPurpose = policyText(policy, "purpose") ?? policyText(policy, "usagePurpose");
  const permissions = policyList(policy, "permissions");
  const prohibitions = policyList(policy, "prohibitions");
  const validityRule = policyText(policy, "validityRule");
  const retentionRule = policyText(policy, "retentionRule");
  const policyCode = policyText(policy, "code") ?? "PROJECT_MEMBERSHIP";
  const policyVersion = typeof policy.templateVersion === "number" ? policy.templateVersion : null;
  const policyId = policyText(policy, "policyId");
  const policyValidFrom = policyText(policy, "validFrom");
  const policyValidUntil = policyText(policy, "validUntil") ?? invitation.invitationExpiresAt;

  const decide = async (kind: "accept" | "reject") => {
    try {
      if (kind === "accept") await accept.mutateAsync({ id: invitation.id, data: { policyAccepted: true } });
      else await reject.mutateAsync({ id: invitation.id, data: {} });
      await client.invalidateQueries({ queryKey: getListAnProjectInvitationsQueryKey() });
      toast({
         title: kind === "accept"
           ? "Projektaufnahme angenommen"
          : "Einladung abgelehnt",
      });
    } catch {
      toast({ title: "Aktion konnte nicht ausgeführt werden", description: "Bitte versuchen Sie es erneut.", variant: "destructive" });
    }
  };

  return (
    <article data-testid={`card-invitation-${invitation.id}`} className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="absolute inset-y-0 left-0 w-1 bg-accent" />
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/25 text-primary">
            <Building2 className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Projekteinladung</p>
            <h2 className="mt-1 line-clamp-2 break-words text-lg font-semibold">{invitation.projectName || "Projektname nicht veröffentlicht"}</h2>
            <p className="mt-1 text-xs text-muted-foreground">Von {invitation.senderAgOrgName ?? "Auftraggebername nicht veröffentlicht"} · {dateText(invitation.createdAt, true)}</p>
          </div>
        </div>
        <Badge variant="outline" className={invitation.status === "PENDING" ? "border-amber-600/30 bg-amber-500/10 text-amber-800" : "border-border text-muted-foreground"}>
          {invitation.status === "PENDING" ? "Offen" : invitation.status === "ACCEPTED" ? "Beigetreten" : "Abgelehnt"}
        </Badge>
      </div>
      <div className="mt-5 space-y-2 rounded-xl border bg-muted/20 p-3 text-sm">
        <div className="flex items-center gap-2 font-medium">
          <Building2 className="h-4 w-4 text-primary" />
          Projektaufnahme
        </div>
        <div className="grid gap-1 sm:grid-cols-2">
          <p><span className="text-muted-foreground">Projekt:</span> {invitation.projectName || "Projektname nicht veröffentlicht"}</p>
          {invitation.projectLocation && (
            <p><span className="text-muted-foreground">Ort:</span> {invitation.projectLocation}</p>
          )}
        </div>
        {invitation.projectDescription && <p>{invitation.projectDescription}</p>}
      </div>
      {invitation.invitationMessage && <p className="mt-4 rounded-xl bg-muted/60 p-3 text-sm leading-relaxed">{invitation.invitationMessage}</p>}
       <div className="mt-4 space-y-2 rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm">
         <div className="flex items-center gap-2 font-medium">
           <Lock className="h-4 w-4 text-primary" />
           Policy-Vorschau
         </div>
         <p className="text-muted-foreground">Diese Einladung enthält nur minimale Projektbasisdaten. Sie ist keine Leistungsfreigabe und erzeugt keinen EDC-Vertrag oder Datentransfer.</p>
       </div>
      <div className="mt-4 space-y-2 rounded-xl border p-3 text-sm">
        <div className="flex items-center gap-2 font-medium">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <span>{policyName}</span>
          <Badge variant="outline" className="ml-auto text-[10px]">{policyCode}</Badge>
        </div>
        {(policyVersion || policyId) && (
          <p className="text-xs text-muted-foreground">
            {policyVersion ? `Version ${policyVersion}` : ""}
            {policyVersion && policyId ? " · " : ""}
            {policyId ? `Nachweis ${policyId}` : ""}
          </p>
        )}
        {policyPurpose && <p className="text-muted-foreground">{policyPurpose}</p>}
        {policyText(policy, "description") && <p>{policyText(policy, "description")}</p>}
        {permissions.length > 0 && <p><strong>Erlaubt:</strong> {permissions.join(", ")}</p>}
        {prohibitions.length > 0 && <p><strong>Nicht erlaubt:</strong> {prohibitions.join(", ")}</p>}
        {validityRule && <p><strong>Bedingungen:</strong> {validityRule}</p>}
        {retentionRule && <p><strong>Aufbewahrung:</strong> {retentionRule}</p>}
        {(policyValidFrom || policyValidUntil) && (
          <p>
            <strong>Gültigkeit:</strong>{" "}
            {policyValidFrom ? `ab ${dateText(policyValidFrom)}` : "ab Annahme"}
            {policyValidUntil ? ` bis ${dateText(policyValidUntil)}` : " · ohne festes Enddatum"}
          </p>
        )}
      </div>
      {invitation.status === "PENDING" ? (
        <div className="mt-5 space-y-4">
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-background/60 p-3 text-sm">
            <Checkbox data-testid={`checkbox-policy-${invitation.id}`} checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} />
             <span>Ich bestätige die angezeigte Policy-Vorschau. Die Projektmitgliedschaft wird erst nach meiner ausdrücklichen Annahme aktiviert. Eine spätere Leistungsfreigabe ist ein separater Prozess.</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button data-testid={`button-accept-invitation-${invitation.id}`} disabled={!confirmed || busy} onClick={() => void decide("accept")}><Check className="mr-2 h-4 w-4" />Projekt beitreten</Button>
            <Button data-testid={`button-reject-invitation-${invitation.id}`} variant="outline" disabled={busy} onClick={() => void decide("reject")}><X className="mr-2 h-4 w-4" />Ablehnen</Button>
          </div>
        </div>
      ) : invitation.status === "ACCEPTED" ? (
        <div className="mt-5 rounded-xl border border-emerald-700/20 bg-emerald-600/10 p-3 text-sm text-emerald-900 dark:text-emerald-200">
          <p className="font-semibold">Projektmitgliedschaft ist aktiv</p>
          <p className="mt-1 leading-relaxed">
            Aktuell ist keine Leistungsfreigabe erforderlich. Der Auftraggeber kann
            nun projektbezogene Leistungen separat freigeben. Neue Freigaben erscheinen
            im Datenraum.
          </p>
          <Link href="/data-room" className="mt-2 inline-flex items-center gap-1 font-medium text-primary hover:underline">
            Datenraum öffnen <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : (
        <p className="mt-5 text-sm text-muted-foreground">
          Projektaufnahme abgelehnt. Leistungsfreigaben bleiben für dieses Projekt gesperrt.
        </p>
      )}
    </article>
  );
}

function RequestCard({ item }: { item: AnLeistungsanfrageListItem }) {
  const due = deadline(item);
  const title = item.takt.kurzbezeichnung || item.takt.taktBezeichnung || "Leistung ohne Bezeichnung";
  return (
    <article data-testid={`card-request-${item.id}`} className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className={`h-1 ${due.urgent ? "bg-accent" : "bg-primary/70"}`} />
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
             <h2 data-testid={`text-request-title-${item.id}`} className="line-clamp-2 break-words text-lg font-semibold">{title}</h2>
          </div>
          <StatusBadge status={item.status} />
        </div>
        <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 border-y border-border/70 py-4 text-sm">
          <div className="col-span-2 flex min-w-0 items-start gap-2"><UserRound className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div className="min-w-0"><p className="text-[11px] text-muted-foreground">Auftraggeber</p><p className="mt-0.5 break-words font-medium">{item.guOrgName || "Auftraggebername nicht veröffentlicht"}</p></div></div>
          <div className="flex min-w-0 items-start gap-2"><Building2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div className="min-w-0"><p className="text-[11px] text-muted-foreground">Projekt</p><p className="mt-0.5 break-words font-medium">{item.project.name || "Nicht veröffentlicht"}</p></div></div>
          <div className="flex min-w-0 items-start gap-2"><ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div className="min-w-0"><p className="text-[11px] text-muted-foreground">Leistung</p><p className="mt-0.5 break-words font-medium">{item.takt.kurzbezeichnung || "Nicht veröffentlicht"}</p></div></div>
           <div className="col-span-2 flex items-start gap-2"><CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div><p className="text-[11px] text-muted-foreground">Zeitraum</p><p className="mt-0.5 font-medium">{dateText(item.plannedStart)} – {dateText(item.plannedEnd)}</p></div></div>
        </div>
         <div data-testid={`deadline-request-${item.id}`} className={`mt-4 flex items-center gap-2 text-sm font-medium ${due.tone}`}><Clock3 className="h-4 w-4" />Frist: {due.label}{item.responseRequiredBy && <span className="font-normal text-muted-foreground">({dateText(item.responseRequiredBy, true)})</span>}</div>
        <div className="mt-auto flex items-center justify-between gap-3 pt-5">
          <Link aria-label={title} data-testid={`link-open-request-${item.id}`} href={`/leistungsanfragen/${item.leistungsanfrageId}`} className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90">
             Anfrage prüfen<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </article>
  );
}

export default function LeistungsanfragenInboxPage() {
  useLocation();
  const [view, setView] = useState<ViewFilter>("OPEN");
  const [showFilters, setShowFilters] = useState(false);
  const [status, setStatus] = useState<"ALL" | AnLeistungsanfrageListItemStatus>("ALL");
  const requestQuery = useListAnLeistungsanfragen(
    status === "ALL" ? undefined : { status },
    { query: { queryKey: getListAnLeistungsanfragenQueryKey(status === "ALL" ? undefined : { status }), refetchInterval: 15000, refetchIntervalInBackground: false } },
  );
  const invitationQuery = useListAnProjectInvitations({ query: { queryKey: getListAnProjectInvitationsQueryKey(), refetchInterval: 15000, refetchIntervalInBackground: false } });
  const requests = Array.isArray(requestQuery.data) ? requestQuery.data : [];
  const invitations = Array.isArray(invitationQuery.data) ? invitationQuery.data : [];
  const shownRequests = useMemo(() => requests.filter((item) => view === "DONE" ? isDone(item.status) : view === "WAITING" ? isWaiting(item.status) : isTodo(item.status)), [requests, view]);
  const shownInvitations = view === "OPEN" ? invitations.filter((item) => item.status === "PENDING") : view === "DONE" ? invitations.filter((item) => item.status !== "PENDING") : [];
  const todoCount = requests.filter((item) => isTodo(item.status)).length + invitations.filter((item) => item.status === "PENDING").length;
  const waitingCount = requests.filter((item) => isWaiting(item.status)).length;
  const doneCount = requests.filter((item) => isDone(item.status)).length + invitations.filter((item) => item.status !== "PENDING").length;
  const loading = requestQuery.isLoading || invitationQuery.isLoading;
  const error = requestQuery.isError && invitationQuery.isError;

  if (loading) return <div className="mx-auto w-full max-w-7xl space-y-6 p-5 lg:p-8"><Skeleton className="h-10 w-80" /><Skeleton className="h-16 w-full" /><div className="grid gap-5 lg:grid-cols-2"><Skeleton className="h-96" /><Skeleton className="h-96" /></div></div>;
  if (error) return <div className="mx-auto flex min-h-[60dvh] max-w-lg flex-col items-center justify-center gap-4 p-6 text-center"><AlertTriangle className="h-10 w-10 text-destructive" /><h1 className="text-lg font-semibold">Anfragen konnten nicht geladen werden</h1><p className="text-sm text-muted-foreground">Die lokale Inbox ist gerade nicht erreichbar.</p><Button data-testid="button-retry-inbox" variant="outline" onClick={() => { void requestQuery.refetch(); void invitationQuery.refetch(); }}><RefreshCw className="mr-2 h-4 w-4" />Erneut laden</Button></div>;

  return (
    <main className="mx-auto w-full max-w-7xl space-y-7 p-5 pb-12 lg:p-8">
       <header className="flex flex-col gap-5 border-b border-border/70 pb-6 md:flex-row md:items-end md:justify-between">
        <div>
           <p className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-primary">AN / LEISTUNGSANFRAGEN</p>
            <h1 data-testid="text-inbox-title" className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Anfragen</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">Ihre nächsten Aufgaben zuerst: Leistungsanfragen prüfen, Machbarkeit bewerten und eine klare Rückmeldung senden.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="h-2 w-2 rounded-full bg-emerald-600" />Lokal synchronisiert</div>
      </header>
        <section className="rounded-2xl border border-border bg-card p-3 shadow-sm">
          <div role="tablist" aria-label="Anfragen filtern" className="grid grid-cols-3 gap-1 rounded-xl bg-muted/70 p-1">
            {([
              ["OPEN", "Zu erledigen", todoCount],
              ["WAITING", "Wartet auf AG", waitingCount],
              ["DONE", "Erledigt", doneCount],
            ] as const).map(([value, label, count]) => <button role="tab" aria-selected={view === value} data-testid={`button-inbox-tab-${value.toLowerCase()}`} key={value} type="button" onClick={() => setView(value)} className={`rounded-lg px-2 py-2.5 text-sm font-medium transition-colors sm:px-3 ${view === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{label}<span className="ml-1.5 font-mono text-[10px] text-muted-foreground">{count}</span></button>)}
          </div>
          <div className="mt-3 flex justify-end">
            <Button data-testid="button-toggle-filters" type="button" variant="ghost" size="sm" onClick={() => setShowFilters((current) => !current)}><ChevronDown className={`mr-2 h-4 w-4 transition-transform ${showFilters ? "rotate-180" : ""}`} />Detailfilter</Button>
          </div>
          {showFilters && <div data-testid="detail-filters" className="grid gap-3 border-t border-border/70 pt-3 sm:grid-cols-2"><div><label className="text-xs font-medium text-muted-foreground" htmlFor="status-filter">Status</label><Select value={status} onValueChange={(value) => setStatus(value as typeof status)}><SelectTrigger data-testid="select-status-filter" id="status-filter" className="mt-1 w-full"><SelectValue placeholder="Alle Leistungsstatus" /></SelectTrigger><SelectContent><SelectItem value="ALL">Alle Leistungsstatus</SelectItem>{Object.entries(STATUS_LABELS).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select></div><p className="self-end text-xs text-muted-foreground">Weitere Filter erscheinen hier, ohne die drei Hauptansichten zu überladen.</p></div>}
      </section>
      {requestQuery.isError && <div className="flex items-center justify-between rounded-xl border border-amber-600/20 bg-amber-500/10 px-4 py-3 text-sm"><span>Leistungsanfragen konnten nicht aktualisiert werden.</span><Button data-testid="button-retry-requests" size="sm" variant="ghost" onClick={() => void requestQuery.refetch()}>Erneut laden</Button></div>}
      {invitationQuery.isError && <div className="flex items-center justify-between rounded-xl border border-amber-600/20 bg-amber-500/10 px-4 py-3 text-sm"><span>Projekteinladungen konnten nicht aktualisiert werden.</span><Button data-testid="button-retry-invitations" size="sm" variant="ghost" onClick={() => void invitationQuery.refetch()}>Erneut laden</Button></div>}
         {shownInvitations.length === 0 && shownRequests.length === 0 ? <div data-testid="empty-inbox" className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center"><Inbox className="h-11 w-11 text-primary/60" /><h2 className="mt-4 text-lg font-semibold">{view === "OPEN" ? "Nichts zu erledigen" : view === "WAITING" ? "Keine Anfragen warten auf den Auftraggeber" : "Keine erledigten Anfragen"}</h2><p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{view === "OPEN" ? "Neue Projekteinladungen und Leistungsanfragen erscheinen hier, sobald sie für Ihr Unternehmen veröffentlicht wurden." : "Passen Sie den Status im Detailfilter an, wenn Sie eine bestimmte Anfrage suchen."}</p></div> : <div className="space-y-7">
          {shownRequests.length > 0 && (
            <section aria-labelledby="requests-section-title">
              {shownInvitations.length > 0 && <div className="mb-3 flex items-center justify-between"><h2 id="requests-section-title" className="text-sm font-semibold">Leistungsanfragen</h2><span className="text-xs text-muted-foreground">{shownRequests.length} in dieser Ansicht</span></div>}
              <div className="grid gap-5 lg:grid-cols-2">{shownRequests.map((item) => <RequestCard key={item.id} item={item} />)}</div>
            </section>
          )}
          {shownInvitations.length > 0 && (
            <section aria-labelledby="invitations-section-title">
              <div className="mb-3 flex items-center justify-between"><h2 id="invitations-section-title" className="text-sm font-semibold">Projektaufnahmen</h2><span className="text-xs text-muted-foreground">{shownInvitations.length} in dieser Ansicht</span></div>
              <div className="grid gap-5 lg:grid-cols-2">{shownInvitations.map((item) => <InvitationCard key={item.id} invitation={item} />)}</div>
            </section>
          )}
        </div>}
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{shownRequests.length} Leistungsanfragen · {shownInvitations.length} Projektaufnahmen in dieser Ansicht</p>
    </main>
  );
}