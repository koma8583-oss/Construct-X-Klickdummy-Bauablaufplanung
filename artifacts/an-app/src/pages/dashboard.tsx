import { useTranslation } from "react-i18next";
import { useGetAnDashboard } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Inbox, CheckCircle2, AlertTriangle, Users, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { Link } from "wouter";

export default function Dashboard() {
  const { t } = useTranslation();
  const { data: dashboard, isLoading, isError, refetch } = useGetAnDashboard();

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

  const criticalCount =
    (dashboard.upcomingDeadlines as any[])?.filter(
      (d) => d.status === "ALTERNATIVE_PROPOSED" && d.isWithinBuffer === false,
    )?.length ?? 0;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold text-foreground">{t("nav.dashboard")}</h1>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("dashboard.pendingRequests")}
            </CardTitle>
            <Inbox className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{dashboard.pendingRequests}</div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("dashboard.confirmedWork")}
            </CardTitle>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{dashboard.confirmedWork}</div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("dashboard.criticalProposals")}
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{criticalCount}</div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("nav.resources")}
            </CardTitle>
            <Users className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {(dashboard.resourceUtilization as any[])?.length ?? 0}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Requests */}
        <Card className="bg-card border-border col-span-1">
          <CardHeader>
            <CardTitle>{t("dashboard.recentRequests")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!(dashboard.recentRequests as any[])?.length ? (
              <p className="text-sm text-muted-foreground">{t("requests.empty")}</p>
            ) : (
              (dashboard.recentRequests as any[]).slice(0, 5).map((req) => (
                <Link key={req.id} href={`/requests/${req.id}`} className="block">
                  <div className="flex items-center justify-between p-3 rounded hover:bg-sidebar-accent transition-colors border border-border">
                    <div>
                      <div className="font-medium text-sm text-foreground">
                        {req.takt?.gewerk
                          ? `${req.takt.gewerk} - ${req.takt.zone}${req.takt.taktBezeichnung ? ` (${req.takt.taktBezeichnung})` : ""}`
                          : `Vergabe ${req.id.slice(0, 8)}`}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {req.agOrganization?.name ?? "Auftraggeber"}
                      </div>
                    </div>
                    <div className="text-xs">
                      <span
                        className={`px-2 py-1 rounded text-[10px] font-semibold tracking-wide ${
                          req.status === "PENDING"
                            ? "bg-amber-500/10 text-amber-500"
                            : req.status === "CONFIRMED"
                              ? "bg-emerald-500/10 text-emerald-500"
                              : req.status === "ALTERNATIVE_PROPOSED"
                                ? "bg-blue-500/10 text-blue-500"
                                : "bg-red-500/10 text-red-500"
                        }`}
                      >
                        {t(`common.status.${req.status}`)}
                      </span>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        {/* Upcoming Deadlines */}
        <Card className="bg-card border-border col-span-1">
          <CardHeader>
            <CardTitle>{t("dashboard.upcomingDeadlines")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!(dashboard.upcomingDeadlines as any[])?.length ? (
              <p className="text-sm text-muted-foreground">{t("gantt.empty")}</p>
            ) : (
              (dashboard.upcomingDeadlines as any[]).slice(0, 5).map((req) => (
                <div
                  key={req.id}
                  className="flex items-start gap-4 p-3 border border-border rounded"
                >
                  <div className="flex flex-col items-center justify-center bg-sidebar-accent p-2 rounded min-w-[3rem]">
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(req.requestedStart), "MMM")}
                    </span>
                    <span className="text-lg font-bold text-foreground leading-none">
                      {format(new Date(req.requestedStart), "dd")}
                    </span>
                  </div>
                  <div>
                    <div className="font-medium text-sm text-foreground">
                      {req.takt?.gewerk
                        ? `${req.takt.gewerk} - ${req.takt.zone}`
                        : `Vergabe ${req.id.slice(0, 8)}`}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {format(new Date(req.requestedStart), "dd.MM.yyyy")} –{" "}
                      {format(new Date(req.requestedEnd), "dd.MM.yyyy")}
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
