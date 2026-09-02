import { useState } from "react";
import { Link } from "wouter";
import { format, differenceInHours } from "date-fns";
import { de } from "date-fns/locale";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CalendarDays,
  ChevronDown,
  Clock3,
  Inbox,
  RefreshCw,
  UserRound,
} from "lucide-react";
import {
  getListAnLeistungsanfragenQueryKey,
  type AnLeistungsanfrageListItem,
  type AnLeistungsanfrageListItemStatus,
  useListAnLeistungsanfragen,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const STATUS_LABELS: Record<AnLeistungsanfrageListItemStatus, string> = {
  RECEIVED: "Eingegangen",
  DETAILS_RETRIEVED: "In Prüfung",
  UNDER_REVIEW: "In Prüfung",
  RESPONDED: "Antwort gesendet",
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

export type InboxView = "OPEN" | "WAITING" | "DONE";
export type InboxItem = AnLeistungsanfrageListItem;

function dateText(value?: string | null, withTime = false) {
  if (!value) return "Nicht veröffentlicht";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Nicht veröffentlicht";
  return format(parsed, withTime ? "dd.MM.yyyy, HH:mm 'Uhr'" : "dd.MM.yyyy", { locale: de });
}

function isTerminalStatus(status: AnLeistungsanfrageListItemStatus) {
  return ["CONFIRMED", "CANCELLED", "SUPERSEDED"].includes(status);
}

function deadline(item: AnLeistungsanfrageListItem) {
  if (!item.responseRequiredBy) return { label: "Keine Frist veröffentlicht", tone: "text-muted-foreground", urgent: false };
  const hours = differenceInHours(new Date(item.responseRequiredBy), new Date());
  if (hours < 0) return { label: "Antwortfrist abgelaufen", tone: "text-destructive", urgent: true };
  if (hours < 24) return { label: `Antwort in ${Math.max(1, hours)} Std. fällig`, tone: "text-destructive", urgent: true };
  if (hours < 72) return { label: "Antwortfrist läuft bald ab", tone: "text-amber-700 dark:text-amber-300", urgent: true };
  return { label: `Antwort bis ${dateText(item.responseRequiredBy, true)}`, tone: "text-foreground", urgent: false };
}

export function nextActionOwner(item: InboxItem): "AG" | "AN" | null {
  if (item.openProposal?.proposerRole === "AG") return "AN";
  if (item.nextActionOwner === "AN" || item.nextActionOwner === "AG") return item.nextActionOwner;
  if (item.status === "RESPONDED") return "AG";
  if (["RECEIVED", "DETAILS_RETRIEVED", "UNDER_REVIEW", "REVISION_REQUIRED"].includes(item.status)) return "AN";
  return null;
}

export function inboxViewFor(item: InboxItem): InboxView {
  const owner = nextActionOwner(item);
  if (owner === "AN") return "OPEN";
  if (owner === "AG") return "WAITING";
  return "DONE";
}

export interface InboxFilterState {
  inboxFilter: "ALL" | InboxView;
  deadlineFilter: "ALL" | "DUE_SOON" | "OVERDUE" | "EXPIRED";
  statusFilter: string;
  coordinationFilter: string;
  proposalFilter: string;
  actionOwnerFilter: string;
  scheduleFilter: string;
}

export function filterInboxItems(items: InboxItem[], filters: InboxFilterState) {
  return items.filter((item) => {
    if (filters.inboxFilter !== "ALL" && inboxViewFor(item) !== filters.inboxFilter) return false;
    if (filters.statusFilter !== "ALL" && item.status !== filters.statusFilter) return false;
    if (filters.coordinationFilter !== "ALL" && item.coordinationState !== filters.coordinationFilter) return false;
    if (filters.proposalFilter === "OPEN" && !item.openProposal) return false;
    if (filters.proposalFilter === "NONE" && item.openProposal) return false;
    if (filters.actionOwnerFilter !== "ALL") {
      const owner = nextActionOwner(item);
      if (filters.actionOwnerFilter === "NONE" ? owner !== null : owner !== filters.actionOwnerFilter) return false;
    }
    if (filters.deadlineFilter !== "ALL") {
      const due = item.responseRequiredBy ? new Date(item.responseRequiredBy) : null;
      const expired = !!due && due.getTime() < Date.now();
      if (filters.deadlineFilter === "EXPIRED" && !expired) return false;
      if (filters.deadlineFilter === "OVERDUE" && !expired) return false;
      if (filters.deadlineFilter === "DUE_SOON" && (!due || due.getTime() < Date.now() || due.getTime() - Date.now() > 48 * 60 * 60 * 1000)) return false;
    }
    return true;
  });
}

function StatusBadge({ status }: { status: AnLeistungsanfrageListItemStatus }) {
  return <Badge variant="outline" className={`font-medium ${STATUS_TONE[status]}`}>{STATUS_LABELS[status]}</Badge>;
}

function ActionBadge({ item }: { item: InboxItem }) {
  const owner = nextActionOwner(item);
  if (owner === "AN") {
    return <Badge data-testid={`next-action-${item.id}`} className="border-primary/20 bg-primary/10 text-primary hover:bg-primary/10">
      {item.openProposal?.proposerRole === "AG" ? "Neuer AG-Terminvorschlag" : "Ihre Aktion"}
    </Badge>;
  }
  if (owner === "AG") {
    return <Badge data-testid={`next-action-${item.id}`} variant="secondary">Wartet auf AG</Badge>;
  }
  return <Badge data-testid={`next-action-${item.id}`} variant="outline">Erledigt</Badge>;
}

function RequestCard({ item }: { item: InboxItem }) {
  const due = deadline(item);
  const title = item.takt.kurzbezeichnung || item.takt.taktBezeichnung || "Leistung ohne Bezeichnung";
  return (
    <article data-testid={`card-request-${item.id}`} className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className={`h-1 ${due.urgent ? "bg-accent" : "bg-primary/70"}`} />
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 data-testid={`text-request-title-${item.id}`} className="line-clamp-2 break-words text-lg font-semibold">{title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">Nächster Schritt: <span className="font-medium text-foreground">{nextActionOwner(item) === "AN" ? "AN" : nextActionOwner(item) === "AG" ? "AG" : "keiner"}</span></p>
          </div>
          <ActionBadge item={item} />
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
          <StatusBadge status={item.status} />
        </div>
      </div>
    </article>
  );
}

export default function LeistungsanfragenInboxPage() {
  const [view, setView] = useState<InboxView>("OPEN");
  const [showFilters, setShowFilters] = useState(false);
  const [status, setStatus] = useState<"ALL" | AnLeistungsanfrageListItemStatus>("ALL");
  const requestQuery = useListAnLeistungsanfragen(
    status === "ALL" ? undefined : { status },
    { query: { queryKey: getListAnLeistungsanfragenQueryKey(status === "ALL" ? undefined : { status }), refetchInterval: 15000, refetchIntervalInBackground: false } },
  );
  const requests = Array.isArray(requestQuery.data) ? requestQuery.data : [];
  const shownRequests = requests.filter((item) => inboxViewFor(item) === view);
  const todoCount = requests.filter((item) => inboxViewFor(item) === "OPEN").length;
  const waitingCount = requests.filter((item) => inboxViewFor(item) === "WAITING").length;
  const doneCount = requests.filter((item) => inboxViewFor(item) === "DONE").length;

  if (requestQuery.isLoading) return <div className="mx-auto w-full max-w-7xl space-y-6 p-5 lg:p-8"><Skeleton className="h-10 w-80" /><Skeleton className="h-16 w-full" /><div className="grid gap-5 lg:grid-cols-2"><Skeleton className="h-96" /><Skeleton className="h-96" /></div></div>;
  if (requestQuery.isError) return <div className="mx-auto flex min-h-[60dvh] max-w-lg flex-col items-center justify-center gap-4 p-6 text-center"><AlertTriangle className="h-10 w-10 text-destructive" /><h1 className="text-lg font-semibold">Anfragen konnten nicht geladen werden</h1><p className="text-sm text-muted-foreground">Die Leistungsanfragen sind gerade nicht erreichbar.</p><Button data-testid="button-retry-inbox" variant="outline" onClick={() => void requestQuery.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Erneut laden</Button></div>;

  return (
    <main className="mx-auto w-full max-w-7xl space-y-7 p-5 pb-12 lg:p-8">
      <header className="flex flex-col gap-5 border-b border-border/70 pb-6 md:flex-row md:items-end md:justify-between">
        <div><p className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-primary">AN / LEISTUNGSANFRAGEN</p><h1 data-testid="text-inbox-title" className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Anfragen</h1><p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">Die Ansicht richtet sich nach dem nächsten Schritt: Ihre Aufgaben, offene Entscheidungen des Auftraggebers und abgeschlossene Leistungsanfragen.</p></div>
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
        <div className="mt-3 flex justify-end"><Button data-testid="button-toggle-filters" type="button" variant="ghost" size="sm" onClick={() => setShowFilters((current) => !current)}><ChevronDown className={`mr-2 h-4 w-4 transition-transform ${showFilters ? "rotate-180" : ""}`} />Detailfilter</Button></div>
        {showFilters && <div data-testid="detail-filters" className="grid gap-3 border-t border-border/70 pt-3 sm:grid-cols-2"><div><label className="text-xs font-medium text-muted-foreground" htmlFor="status-filter">Technischer Status</label><Select value={status} onValueChange={(value) => setStatus(value as typeof status)}><SelectTrigger data-testid="select-status-filter" id="status-filter" className="mt-1 w-full"><SelectValue placeholder="Alle Leistungsstatus" /></SelectTrigger><SelectContent><SelectItem value="ALL">Alle Leistungsstatus</SelectItem>{Object.entries(STATUS_LABELS).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select></div><p className="self-end text-xs text-muted-foreground">Die drei Hauptansichten werden nicht aus diesem technischen Status abgeleitet.</p></div>}
      </section>
      {shownRequests.length === 0 ? <div data-testid="empty-inbox" className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center"><Inbox className="h-11 w-11 text-primary/60" /><h2 className="mt-4 text-lg font-semibold">{view === "OPEN" ? "Nichts zu erledigen" : view === "WAITING" ? "Keine Anfragen warten auf den Auftraggeber" : "Keine erledigten Anfragen"}</h2><p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{view === "OPEN" ? "Neue Leistungsanfragen und neue AG-Terminvorschläge erscheinen hier, sobald Sie handeln müssen." : "Passen Sie den Status im Detailfilter an, wenn Sie eine bestimmte Anfrage suchen."}</p></div> : <div className="grid gap-5 lg:grid-cols-2">{shownRequests.map((item) => <RequestCard key={item.id} item={item} />)}</div>}
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{shownRequests.length} Leistungsanfragen in dieser Ansicht</p>
    </main>
  );
}