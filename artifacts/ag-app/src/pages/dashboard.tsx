import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  Database,
  Inbox,
  Layers3,
  ListChecks,
  Mail,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  UsersRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type {
  AgDashboard,
  DashboardAction,
  DashboardOperationalItem,
  ProjectCollaboration,
} from "@workspace/api-client-react";
import {
  getGetAgDashboardQueryKey,
  useGetAgDashboard,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function formatDate(value: string | null | undefined, withTime = false) {
  if (!value) return "Keine Frist";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Keine Frist";
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
    warning: "text-amber-600 dark:text-amber-300",
    danger: "text-destructive",
    accent: "text-primary",
  }[tone];

  return (
    <Card className="group relative overflow-hidden border-card-border bg-card transition-transform duration-200 hover:-translate-y-0.5">
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
  const isDeliveryRetry =
    action.kind === "RETRY_INVITATION_DELIVERY" || action.kind === "RETRY_DATA_OFFER_DELIVERY";
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
        ) : isDeliveryRetry ? (
          <RefreshCw className="h-4 w-4" />
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
        {isDeliveryRetry && (
          <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
            <RefreshCw className="h-3 w-3" /> Erneut zustellbar
          </span>
        )}
      </span>
      <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
    </Link>
  );
}

function CollaborationCard({ collaboration }: { collaboration: ProjectCollaboration }) {
  const needsPublication =
    collaboration.membershipStatus === "ACTIVE" &&
    collaboration.dataOfferStatus === "NOT_PUBLISHED";
  return (
    <Card className="border-card-border bg-card transition-colors hover:border-primary/35">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Building2 className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{collaboration.projectName}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {collaboration.partnerName}
              </p>
            </div>
          </div>
          <Badge variant="outline" className="shrink-0 text-[10px]">
            Zusammenarbeit
          </Badge>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <div className="rounded-md bg-muted/45 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Projektbeitritt
            </p>
            <p className="mt-1 text-xs font-medium">{collaboration.membershipLabel}</p>
          </div>
          <div className="rounded-md bg-muted/45 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Datenraum
            </p>
            <p className="mt-1 text-xs font-medium">{collaboration.dataOfferLabel}</p>
          </div>
        </div>
        <Link
          href={collaboration.targetUrl}
          data-testid={`link-collaboration-${collaboration.id}`}
          className={`mt-3 inline-flex items-center gap-1.5 text-xs font-semibold transition-colors hover:underline ${
            needsPublication ? "text-primary" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {needsPublication ? "Daten für AN freigeben" : "Zusammenarbeit öffnen"}
          <ArrowUpRight className="h-3.5 w-3.5" />
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
        <Clock3 className="h-4 w-4" />
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
        {[1, 2, 3, 4].map((item) => (
          <Skeleton key={item} className="h-32 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Skeleton className="h-96 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    </div>
  );
}

function ErrorState({ retry }: { retry: () => void }) {
  return (
    <Card className="mx-auto flex min-h-[360px] max-w-xl items-center justify-center border-destructive/25">
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
  const { data: dashboard, isLoading, isError, refetch } = useGetAgDashboard({
    query: {
      queryKey: getGetAgDashboardQueryKey(),
      refetchInterval: 30_000,
      refetchIntervalInBackground: false,
    },
  });

  if (isLoading) return <LoadingState />;
  if (isError || !dashboard) return <ErrorState retry={() => void refetch()} />;

  const d = dashboard as AgDashboard;
  const actions = d.nextActions ?? [];
  const collaborations = d.projectCollaborations ?? [];
  const outlook = d.operationalOutlook ?? [];
  const hasWork = actions.length > 0;

  return (
    <main className="mx-auto min-h-[100dvh] max-w-7xl space-y-8">
      <header className="flex flex-col justify-between gap-4 border-b border-border/70 pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.22em] text-primary">
            TaktKoord · Leitpult
          </p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("dashboard.title")}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Prozesslage und nächste Entscheidungen — gebündelt für Ihre laufenden Vorhaben.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          Aktualisiert automatisch
        </div>
      </header>

      <section aria-label="Prozesskennzahlen" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          label="Aufgaben offen"
          value={d.kpis.openTasks}
          detail="Ihre nächsten Entscheidungen"
          icon={ListChecks}
          tone={d.kpis.openTasks > 0 ? "accent" : "default"}
        />
        <KpiTile
          label="Überfällig"
          value={d.kpis.overdueTasks}
          detail={d.kpis.overdueTasks > 0 ? "Bitte zuerst bearbeiten" : "Alles im Zeitfenster"}
          icon={TriangleAlert}
          tone={d.kpis.overdueTasks > 0 ? "danger" : "default"}
        />
        <KpiTile
          label="Einladungen offen"
          value={d.kpis.openInvitations}
          detail="Projektbeitritte ausstehend"
          icon={Mail}
          tone={d.kpis.openInvitations > 0 ? "warning" : "default"}
        />
        <KpiTile
          label="Datenfreigaben ausstehend"
          value={d.kpis.pendingDataOffers}
          detail="Für Partner noch nicht bestätigt"
          icon={Database}
          tone={d.kpis.pendingDataOffers > 0 ? "warning" : "default"}
        />
      </section>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <UsersRound className="h-4 w-4 text-primary" />
        <span>
          <strong className="font-semibold text-foreground">{d.activeProjectsCount}</strong>{" "}
          aktive {d.activeProjectsCount === 1 ? "Projektzusammenarbeit" : "Projektzusammenarbeiten"}
        </span>
        <span className="text-border">·</span>
        <span>Kontext für Ihre Disposition</span>
      </div>

      <section className="grid gap-8 lg:grid-cols-[1.18fr_0.82fr]">
        <Card className="border-primary/20 bg-card">
          <CardHeader className="pb-1">
            <SectionHeading
              eyebrow="Jetzt im Blick"
              title="Nächste Aktionen"
              icon={ListChecks}
              action={
                hasWork ? (
                  <Badge variant="outline" className="text-[10px]">
                    {actions.length} offen
                  </Badge>
                ) : undefined
              }
            />
          </CardHeader>
          <CardContent className="pt-0">
            {hasWork ? (
              <div>
                {actions.map((action) => (
                  <ActionRow key={action.id} action={action} />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-5 py-12 text-center">
                <CheckCircle2 className="h-9 w-9 text-emerald-500/75" />
                <p className="mt-3 text-sm font-semibold">Keine offenen Aktionen</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Ihre Koordination ist auf dem aktuellen Stand.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-card-border bg-card">
          <CardHeader className="pb-1">
            <SectionHeading eyebrow="Verbindung" title="Projektzusammenarbeit" icon={UsersRound} />
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {collaborations.length > 0 ? (
              collaborations.slice(0, 4).map((collaboration) => (
                <CollaborationCard key={collaboration.id} collaboration={collaboration} />
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-border px-5 py-10 text-center">
                <ShieldCheck className="mx-auto h-8 w-8 text-muted-foreground/60" />
                <p className="mt-3 text-sm font-medium">Noch keine Projektzusammenarbeit</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Sobald ein Partner eingeladen ist, erscheint die Verbindung hier.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section>
        <SectionHeading
          eyebrow="Planungshorizont"
          title="Operativer Ausblick"
          icon={Clock3}
          action={
            <Link
              href="/projects"
              data-testid="link-all-projects"
              className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              Projekte öffnen <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          }
        />
        {outlook.length > 0 ? (
          <div className="grid gap-2 md:grid-cols-2">
            {outlook.map((item) => (
              <OperationalRow key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <Card className="border-dashed border-border bg-card/50">
            <CardContent className="flex flex-col items-center px-5 py-10 text-center">
              <Layers3 className="h-8 w-8 text-muted-foreground/60" />
              <p className="mt-3 text-sm font-medium">Keine anstehenden Leistungen</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Im aktuellen Planungshorizont sind keine Termine hinterlegt.
              </p>
            </CardContent>
          </Card>
        )}
      </section>
    </main>
  );
}