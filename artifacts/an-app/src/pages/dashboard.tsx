import { useTranslation } from "react-i18next";
import { useGetAnDashboard } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Inbox,
  AlertTriangle,
  Clock,
  Shield,
  CalendarCheck,
  RefreshCw,
  ChevronRight,
  BookOpen,
  ClipboardList,
  CheckCircle2,
  Layers,
  MapPin,
} from "lucide-react";
import { format, isPast } from "date-fns";
import { de } from "date-fns/locale";
import { Link } from "wouter";
import { CoordinationTasksPanel } from "@/components/coordination-tasks-panel";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtDate(s?: string | Date | null): string {
  if (!s) return "—";
  try { return format(new Date(s as string), "dd.MM.yyyy", { locale: de }); } catch { return "—"; }
}

function fmtDateTime(s?: string | Date | null): string {
  if (!s) return "—";
  try { return format(new Date(s as string), "dd.MM.yyyy HH:mm", { locale: de }); } catch { return "—"; }
}

const ACTION_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  OVERDUE:           { label: "Überfällig",              color: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30",      icon: <AlertTriangle className="w-4 h-4 text-red-500" /> },
  POLICY_PENDING:    { label: "Policy akzeptieren",      color: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30", icon: <Shield className="w-4 h-4 text-amber-500" /> },
  RETRIEVE_DATA:     { label: "Leistungsdaten abrufen",   color: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30",    icon: <BookOpen className="w-4 h-4 text-blue-500" /> },
  ADD_REQUIREMENTS:  { label: "Ressourcenbedarf erfassen", color: "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/30", icon: <ClipboardList className="w-4 h-4 text-violet-500" /> },
  SUBMIT_RESPONSE:   { label: "Antwort einreichen",      color: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30", icon: <CalendarCheck className="w-4 h-4 text-emerald-500" /> },
};

// ── KPI Card ──────────────────────────────────────────────────────────────────

interface KpiCardProps {
  title: string;
  value: number;
  icon: React.ReactNode;
  variant?: "default" | "warning" | "danger" | "success";
}

function KpiCard({ title, value, icon, variant = "default" }: KpiCardProps) {
  const valueClass =
    variant === "danger"  ? "text-red-600 dark:text-red-400" :
    variant === "warning" ? "text-amber-600 dark:text-amber-400" :
    variant === "success" ? "text-emerald-600 dark:text-emerald-400" :
    "text-foreground";

  return (
    <Card className="bg-card border-border">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${valueClass}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { t } = useTranslation();
  const { data: dashboard, isLoading, isError, refetch } = useGetAnDashboard({
    query: { queryKey: ["an-dashboard"], refetchInterval: 30_000 },
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError || !dashboard) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center p-6">
        <AlertTriangle className="h-10 w-10 text-destructive" />
        <p className="text-muted-foreground text-sm">Dashboard konnte nicht geladen werden.</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-2" /> Erneut versuchen
        </Button>
      </div>
    );
  }

  const d = dashboard as any;
  const pendingRequests    = d.pendingRequests    ?? 0;
  const policyPending      = d.policyPendingCount ?? 0;
  const dueSoon            = d.dueSoonCount       ?? 0;
  const activeBookings     = d.activeBookingsCount ?? 0;
  const nextActions        = (d.nextActions        as any[]) ?? [];
  const upcomingDeadlines  = (d.upcomingDeadlines  as any[]) ?? [];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold text-foreground">{t("nav.dashboard")}</h1>

      {/* ── Policy-Hinweis Banner ─────────────────────────────────────────── */}
      {policyPending > 0 && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3">
            <Shield className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                {policyPending === 1
                  ? "1 Datenraum-Policy muss noch akzeptiert werden"
                  : `${policyPending} Datenraum-Policies müssen noch akzeptiert werden`}
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-500 mt-0.5">
                Ohne Akzeptanz können die verknüpften Leistungsdaten nicht abgerufen werden. Zum Datenraum →
              </p>
            </div>
          </div>
      )}

      {/* ── KPI Cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title={t("dashboard.pendingRequests")}
          value={pendingRequests}
          icon={<Inbox className="h-4 w-4 text-amber-500" />}
          variant={pendingRequests > 0 ? "warning" : "default"}
        />
        <KpiCard
          title="Policy ausstehend"
          value={policyPending}
          icon={<Shield className="h-4 w-4 text-amber-600" />}
          variant={policyPending > 0 ? "warning" : "default"}
        />
        <KpiCard
          title="Antwort bald fällig"
          value={dueSoon}
          icon={<Clock className="h-4 w-4 text-red-500" />}
          variant={dueSoon > 0 ? "danger" : "default"}
        />
        <KpiCard
          title="Aktive Ressourcenbelegungen"
          value={activeBookings}
          icon={<Layers className="h-4 w-4 text-blue-500" />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Nächste Aktionen ────────────────────────────────────────────── */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-base">Nächste Aktionen</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {nextActions.length === 0 ? (
              <div className="flex flex-col items-center py-8 gap-2 text-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-500/40" />
                <p className="text-sm text-muted-foreground">Keine offenen Aktionen</p>
              </div>
            ) : (
              nextActions.map((action: any) => {
                const meta = ACTION_META[action.action] ?? ACTION_META.SUBMIT_RESPONSE;
                const deadline = action.responseRequiredBy
                  ? new Date(action.responseRequiredBy)
                  : null;
                const isOverdue = deadline ? isPast(deadline) : false;

                return (
                  <Link key={action.id} href={`/leistungsanfragen/${action.id}`}>
                    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors hover:bg-muted/40 ${meta.color}`}>
                      <span className="shrink-0">{meta.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {action.taktBezeichnung
                            ? `${action.gewerk ?? ""} · ${action.zone ?? ""} ${action.taktBezeichnung}`
                            : action.requestNumber}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-[11px] opacity-70">{action.guOrgName ?? "Auftraggebername nicht veröffentlicht"}</span>
                          {action.projectLocation && (
                            <span className="flex items-center gap-0.5 text-[11px] opacity-70">
                              <MapPin className="w-2.5 h-2.5 shrink-0" />
                              <span className="truncate max-w-[120px]">{action.projectLocation}</span>
                            </span>
                          )}
                          {deadline && (
                            <span className={`text-[11px] font-medium ${isOverdue ? "text-red-500" : "opacity-70"}`}>
                              Frist: {fmtDateTime(deadline)}
                            </span>
                          )}
                        </div>
                        {action.projectDescription && (
                          <div className="text-[11px] opacity-60 truncate mt-0.5">
                            {action.projectDescription}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] font-semibold uppercase tracking-wide opacity-70 hidden sm:block">
                          {meta.label}
                        </span>
                        <ChevronRight className="w-4 h-4 opacity-40" />
                      </div>
                    </div>
                  </Link>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* ── Termine ─────────────────────────────────────────────────────── */}
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">{t("dashboard.upcomingDeadlines")}</CardTitle>
            <Link href="/gantt">
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground gap-1">
                Alle <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {upcomingDeadlines.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">{t("gantt.empty")}</p>
            ) : (
              upcomingDeadlines.slice(0, 5).map((req: any) => {
                const deadline = req.responseRequiredBy ? new Date(req.responseRequiredBy) : null;
                const isOverdue = deadline ? isPast(deadline) : false;
                const takt = req.takt as any;
                return (
                  <Link key={req.id} href={`/leistungsanfragen/${req.id}`}>
                    <div className="flex items-start gap-3 p-2.5 border border-border rounded-lg hover:bg-muted/30 transition-colors">
                      {deadline ? (
                        <div className="flex flex-col items-center justify-center bg-sidebar-accent px-2 py-1.5 rounded min-w-[2.5rem]">
                          <span className="text-[10px] text-muted-foreground">
                            {format(deadline, "MMM", { locale: de })}
                          </span>
                          <span className={`text-base font-bold leading-none ${isOverdue ? "text-red-500" : ""}`}>
                            {format(deadline, "dd")}
                          </span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center bg-sidebar-accent px-2 py-1.5 rounded min-w-[2.5rem]">
                          <span className="text-[10px] text-muted-foreground">—</span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {takt?.gewerk
                            ? `${takt.gewerk} – ${takt.zone ?? ""}`
                            : req.requestNumber}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                          <span>{req.guOrgName ?? "Auftraggebername nicht veröffentlicht"}</span>
                          {req.projectLocation && (
                            <span className="flex items-center gap-0.5">
                              <MapPin className="w-3 h-3 shrink-0" />
                              <span className="truncate max-w-[110px]">{req.projectLocation}</span>
                            </span>
                          )}
                          {deadline && (
                            <span className={isOverdue ? "text-red-500 font-semibold" : ""}>
                              Frist: {fmtDate(deadline)}
                            </span>
                          )}
                        </div>
                        {req.projectDescription && (
                          <div className="text-[11px] text-muted-foreground/70 truncate mt-0.5">
                            {req.projectDescription}
                          </div>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
      <CoordinationTasksPanel />
    </div>
  );
}
