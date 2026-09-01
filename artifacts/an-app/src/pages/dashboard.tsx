import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  Database,
  FileCheck2,
  Inbox,
  Mail,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  UsersRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type {
  AnDashboard,
  DashboardAction,
  DashboardDataOffer,
  DashboardInvitation,
  DashboardOperationalItem,
  ProjectCollaboration,
} from "@workspace/api-client-react";
import {
  getGetAnDashboardQueryKey,
  useGetAnDashboard,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function formatDate(value: string | null | undefined, withTime = false) {
  if (!value) return "Kein Termin";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Kein Termin";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "short",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

const actionStatus: Record<
  DashboardAction["status"],
  { label: string; className: string }
> = {
  OVERDUE: {
    label: "Überfällig",
    className: "border-destructive/35 bg-destructive/10 text-destructive",
  },
  DUE_TODAY: {
    label: "Heute fällig",
    className: "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  DUE_SOON: {
    label: "Demnächst",
    className: "border-primary/25 bg-primary/10 text-primary",
  },
  OPEN: {
    label: "Offen",
    className: "border-border bg-muted/40 text-muted-foreground",
  },
};

function KpiTile({
  label,
  value,
  detail,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: number;
  detail: string;
  icon: LucideIcon;
  tone?: "default" | "warning" | "danger" | "accent";
}) {
  const toneClass = {
    default: "text-foreground",
    warning: "text-amber-700 dark:text-amber-300",
    danger: "text-destructive",
    accent: "text-primary",
  }[tone];

  return (
    <Card className="group relative overflow-hidden border-border bg-card transition-transform duration-200 hover:-translate-y-0.5">
      <div className="absolute inset-x-0 top-0 h-0.5 bg-primary/35 transition-colors group-hover:bg-primary" />
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
          {label}
        </CardTitle>
        <Icon className={`h-4 w-4 ${toneClass}`} strokeWidth={1.8} />
      </CardHeader>
      <CardContent>
        <div className={`text-3xl font-semibold tracking-tight ${toneClass}`}>{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function SectionHeading({
  eyebrow,
  title,
  icon: Icon,
  action,
}: {
  eyebrow?: string;
  title: string;
  icon: LucideIcon;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        {eyebrow && (
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
            {eyebrow}
          </p>
        )}
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Icon className="h-[18px] w-[18px] text-primary" strokeWidth={1.8} />
          {title}
        </h2>
      </div>
      {action}
    </div>
  );
}

function ActionRow({ action }: { action: DashboardAction }) {
  const status = actionStatus[action.status];
  return (
    <Link
      href={action.targetUrl}
      data-testid={`link-dashboard-action-${action.id}`}
      className="group flex items-start gap-3 border-b border-border/70 px-1 py-3.5 transition-colors last:border-b-0 hover:bg-muted/25"
    >
      <span
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
          action.status === "OVERDUE"
            ? "bg-destructive/10 text-destructive"
            : "bg-primary/10 text-primary"
        }`}
      >
        {action.status === "OVERDUE" ? (
          <TriangleAlert className="h-4 w-4" />
        ) : (
          <CircleDot className="h-4 w-4" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{action.title}</span>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${status.className}`}>
            {status.label}
          </span>
        </span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
          {action.description}
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          {action.projectName && <span>{action.projectName}</span>}
          {action.partnerName && (
            <>
              <span className="text-border">•</span>
              <span>{action.partnerName}</span>
            </>
          )}
          {action.dueAt && (
            <>
              <span className="text-border">•</span>
              <span className={action.status === "OVERDUE" ? "font-semibold text-destructive" : ""}>
                Frist {formatDate(action.dueAt, true)}
              </span>
            </>
          )}
        </span>
      </span>
      <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
    </Link>
  );
}

function InvitationCard({ invitation }: { invitation: DashboardInvitation }) {
  const isOpen = invitation.status === "PENDING";
  return (
    <Link
      href={invitation.targetUrl}
      data-testid={`link-invitation-${invitation.id}`}
      className="group flex items-start gap-3 rounded-lg border border-primary/15 bg-background/65 p-3 transition-colors hover:border-primary/35 hover:bg-background"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Mail className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{invitation.projectName}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {invitation.agName} · eingegangen {formatDate(invitation.createdAt)}
        </span>
        <span className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
          isOpen
            ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
            : "border-border bg-muted/40 text-muted-foreground"
        }`}>
          {isOpen ? "Antwort ausstehend" : invitation.status === "ACCEPTED" ? "Angenommen" : "Abgelehnt"}
        </span>
      </span>
      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

function DataOfferCard({ offer }: { offer: DashboardDataOffer }) {
  const policyPending = !offer.policyAcceptedAt;
  return (
    <Link
      href={offer.targetUrl}
      data-testid={`link-data-offer-${offer.publicationId}`}
      className="group flex items-start gap-3 rounded-lg border border-primary/15 bg-background/65 p-3 transition-colors hover:border-primary/35 hover:bg-background"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
        {policyPending ? <ShieldCheck className="h-4 w-4" /> : <FileCheck2 className="h-4 w-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{offer.title}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {offer.projectName} · {offer.agName}
        </span>
        <span className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
          policyPending
            ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
            : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
        }`}>
          {policyPending ? "Policy akzeptieren" : "Freigabe verfügbar"}
        </span>
      </span>
      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

function CollaborationCard({ collaboration }: { collaboration: ProjectCollaboration }) {
  return (
    <Card className="border-border bg-card transition-colors hover:border-primary/35">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Building2 className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{collaboration.projectName}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{collaboration.partnerName}</p>
          </div>
          <Badge variant="outline" className="shrink-0 text-[10px]">Zusammenarbeit</Badge>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <div className="rounded-md bg-muted/55 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Projektbeitritt</p>
            <p className="mt-1 text-xs font-medium">{collaboration.membershipLabel}</p>
          </div>
          <div className="rounded-md bg-muted/55 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Datenraum</p>
            <p className="mt-1 text-xs font-medium">{collaboration.dataOfferLabel}</p>
          </div>
        </div>
        <Link
          href={collaboration.targetUrl}
          data-testid={`link-collaboration-${collaboration.id}`}
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground hover:underline"
        >
          Zusammenarbeit öffnen <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </CardContent>
    </Card>
  );
}

function OperationalRow({ item }: { item: DashboardOperationalItem }) {
  return (
    <Link
      href={item.targetUrl}
      data-testid={`link-operational-item-${item.id}`}
      className="group flex items-center gap-3 rounded-lg border border-border/70 bg-card/65 px-3 py-3 transition-colors hover:border-primary/30 hover:bg-card"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
        <CalendarClock className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.title}</p>
        <p className="truncate text-xs text-muted-foreground">{item.description}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {item.projectName || "Projekt"}{item.partnerName ? ` · ${item.partnerName}` : ""}
        </p>
      </div>
      <div className="hidden shrink-0 text-right sm:block">
        <p className="text-xs font-medium">{item.startsAt ? formatDate(item.startsAt) : "—"}</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          bis {item.dueAt ? formatDate(item.dueAt) : "offen"}
        </p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

function LoadingState() {
  return (
    <div className="mx-auto max-w-7xl space-y-7">
      <div className="space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-32 rounded-xl" />)}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.18fr_0.82fr]">
        <Skeleton className="h-96 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    </div>
  );
}

function ErrorState({ retry }: { retry: () => void }) {
  return (
    <Card className="mx-4 flex min-h-[360px] items-center justify-center border-destructive/25 sm:mx-auto sm:max-w-xl">
      <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h1 className="text-lg font-semibold">Cockpit konnte nicht geladen werden</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Die aktuelle Prozesslage ist gerade nicht verfügbar. Bitte laden Sie die Ansicht erneut.
        </p>
        <Button variant="outline" onClick={retry} data-testid="button-retry-dashboard">
          <RefreshCw className="mr-2 h-4 w-4" /> Erneut laden
        </Button>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { t } = useTranslation();
  const { data: dashboard, isLoading, isError, refetch } = useGetAnDashboard({
    query: {
      queryKey: getGetAnDashboardQueryKey(),
      refetchInterval: 30_000,
      refetchIntervalInBackground: false,
    },
  });

  if (isLoading) return <LoadingState />;
  if (isError || !dashboard) return <ErrorState retry={() => void refetch()} />;

  const d = dashboard as AnDashboard;
  const invitations = d.openInvitations ?? [];
  const offers = d.newDataOffers ?? [];
  const collaborations = d.projectCollaborations ?? [];
  const outlook = d.operationalOutlook ?? [];
  const actions = (d.nextActions ?? []).filter(
    (action) => action.kind !== "REVIEW_PROJECT_INVITATION" && action.kind !== "REVIEW_DATA_OFFER",
  );

  return (
    <main className="mx-auto min-h-[100dvh] max-w-7xl space-y-8">
      <header className="flex flex-col justify-between gap-4 border-b border-border/70 pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.22em] text-primary">
            TaktKoord · Arbeitscockpit
          </p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("nav.dashboard")}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Was heute zählt — Anfragen, Freigaben und Fristen in einer verlässlichen Reihenfolge.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          Aktualisiert automatisch
        </div>
      </header>

      <section aria-label="Prozesskennzahlen" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          label="Einladungen offen"
          value={d.kpis.openInvitations}
          detail="Projektbeitritte beantworten"
          icon={Mail}
          tone={d.kpis.openInvitations > 0 ? "warning" : "default"}
        />
        <KpiTile
          label="Neue Datenfreigaben"
          value={d.kpis.newDataOffers}
          detail="Neue Angebote im Datenraum"
          icon={Database}
          tone={d.kpis.newDataOffers > 0 ? "accent" : "default"}
        />
        <KpiTile
          label="Antworten offen"
          value={d.kpis.openRequests}
          detail="Leistungsanfragen bearbeiten"
          icon={Inbox}
          tone={d.kpis.openRequests > 0 ? "accent" : "default"}
        />
        <KpiTile
          label="Kritische Fristen"
          value={d.kpis.criticalDeadlines}
          detail={d.kpis.criticalDeadlines > 0 ? "Heute oder überfällig" : "Kein kritischer Termin"}
          icon={TriangleAlert}
          tone={d.kpis.criticalDeadlines > 0 ? "danger" : "default"}
        />
      </section>

      <section>
        <SectionHeading
          eyebrow="Priorität"
          title="Nächste Aktionen"
          icon={Inbox}
          action={
            <Badge variant="outline" className="text-[10px]">
              {actions.length} offen
            </Badge>
          }
        />
        <Card className="border-primary/20 bg-card">
          <CardContent className="p-4 sm:p-5">
            {actions.length > 0 ? (
              <div>{actions.map((action) => <ActionRow key={action.id} action={action} />)}</div>
            ) : (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-5 py-12 text-center">
                <CheckCircle2 className="h-9 w-9 text-emerald-500/75" />
                <p className="mt-3 text-sm font-semibold">Keine offenen Aktionen</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Ihre Antworten und Entscheidungen sind auf dem aktuellen Stand.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card data-testid="card-project-invitations" className="border-primary/25 bg-primary/5">
          <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Mail className="h-4 w-4 text-primary" /> Projekteinladungen
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Projektbeitritt unabhängig von späteren Datenfreigaben beantworten.
              </p>
            </div>
            <Badge variant={invitations.length > 0 ? "default" : "secondary"}>
              {invitations.length > 0 ? `${invitations.length} offen` : "Keine offen"}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {invitations.length > 0 ? (
              invitations.slice(0, 3).map((invitation) => (
                <InvitationCard key={invitation.id} invitation={invitation} />
              ))
            ) : (
              <EmptyMini icon={Mail} text="Aktuell liegen keine offenen Projekteinladungen vor." />
            )}
            {invitations.length > 3 && (
              <p className="text-xs text-muted-foreground">+ {invitations.length - 3} weitere Einladungen</p>
            )}
            <Link
              href="/leistungsanfragen?category=INVITATIONS"
              data-testid="link-all-invitations"
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-background/60 px-3 py-2 text-xs font-semibold transition-colors hover:bg-background"
            >
              Alle Projekteinladungen öffnen <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </CardContent>
        </Card>

        <Card data-testid="card-new-data-offers" className="border-primary/25 bg-primary/5">
          <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Database className="h-4 w-4 text-primary" /> Neue Datenfreigaben
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Policy prüfen und freigegebene Projektdaten abrufen.
              </p>
            </div>
            <Badge variant={offers.length > 0 ? "default" : "secondary"}>
              {offers.length > 0 ? `${offers.length} neu` : "Keine neuen"}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {offers.length > 0 ? (
              offers.slice(0, 3).map((offer) => <DataOfferCard key={offer.publicationId} offer={offer} />)
            ) : (
              <EmptyMini icon={Database} text="Aktuell liegen keine neuen Datenfreigaben vor." />
            )}
            {offers.length > 3 && (
              <p className="text-xs text-muted-foreground">+ {offers.length - 3} weitere Datenfreigaben</p>
            )}
            <Link
              href="/data-offers"
              data-testid="link-all-data-offers"
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-background/60 px-3 py-2 text-xs font-semibold transition-colors hover:bg-background"
            >
              Datenfreigaben öffnen <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-8 lg:grid-cols-[0.82fr_1.18fr]">
        <div>
          <SectionHeading eyebrow="Verbindung" title="Projektzusammenarbeit" icon={UsersRound} />
          <div className="space-y-3">
            {collaborations.length > 0 ? (
              collaborations.slice(0, 3).map((collaboration) => (
                <CollaborationCard key={collaboration.id} collaboration={collaboration} />
              ))
            ) : (
              <Card className="border-dashed border-border bg-card/50">
                <CardContent className="px-5 py-10 text-center">
                  <ShieldCheck className="mx-auto h-8 w-8 text-muted-foreground/60" />
                  <p className="mt-3 text-sm font-medium">Keine aktive Zusammenarbeit</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Projektbeitritte und Datenfreigaben erscheinen hier im Zusammenhang.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        <div>
          <SectionHeading eyebrow="Planungshorizont" title="Nächste Fristen" icon={CalendarClock} />
          {outlook.length > 0 ? (
            <div className="space-y-2">{outlook.map((item) => <OperationalRow key={item.id} item={item} />)}</div>
          ) : (
            <Card className="border-dashed border-border bg-card/50">
              <CardContent className="flex flex-col items-center px-5 py-10 text-center">
                <Clock3 className="h-8 w-8 text-muted-foreground/60" />
                <p className="mt-3 text-sm font-medium">Keine anstehenden Fristen</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Im aktuellen Planungshorizont ist nichts kritisch terminiert.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </section>
    </main>
  );
}

function EmptyMini({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-5 py-9 text-center">
      <Icon className="h-7 w-7 text-muted-foreground/60" />
      <p className="mt-2 text-xs text-muted-foreground">{text}</p>
    </div>
  );
}