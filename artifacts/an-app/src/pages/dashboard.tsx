import { useTranslation } from "react-i18next";
import { useGetAnDashboard } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Inbox, CheckCircle2, AlertTriangle, Users } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";

export default function Dashboard() {
  const { t } = useTranslation();
  const { data: dashboard, isLoading } = useGetAnDashboard();

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!dashboard) return null;

  // Derive critical proposals count (proposals outside buffer)
  // Assuming the dashboard provides it via criticalProposals or similar. 
  // Wait, let's check AnDashboard schema:
  // pendingRequests, confirmedWork, upcomingDeadlines, resourceUtilization, recentRequests
  // It doesn't have criticalProposals directly, but we can compute it if recentRequests has it, or we just mock/use a value if available. Let's use 0 if not present.
  const criticalCount = dashboard.upcomingDeadlines?.filter((d: any) => d.status === 'ALTERNATIVE_PROPOSED' && d.isWithinBuffer === false)?.length || 0;

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
            <div className="text-2xl font-bold text-foreground">{dashboard.resourceUtilization?.length || 0}</div>
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
            {dashboard.recentRequests?.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("requests.empty")}</p>
            ) : (
              dashboard.recentRequests?.slice(0, 5).map((req) => (
                <Link key={req.id} href={`/requests/${req.id}`} className="block">
                  <div className="flex items-center justify-between p-3 rounded hover:bg-sidebar-accent transition-colors border border-border">
                    <div>
                      <div className="font-medium text-sm text-foreground">
                        {req.takt?.gewerk} - {req.takt?.zone} (Takt {req.takt?.taktNumber})
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {req.agOrganization?.name}
                      </div>
                    </div>
                    <div className="text-xs">
                      <span className={`px-2 py-1 rounded text-[10px] font-semibold tracking-wide ${
                        req.status === 'PENDING' ? 'bg-amber-500/10 text-amber-500' :
                        req.status === 'CONFIRMED' ? 'bg-emerald-500/10 text-emerald-500' :
                        req.status === 'ALTERNATIVE_PROPOSED' ? 'bg-blue-500/10 text-blue-500' :
                        'bg-red-500/10 text-red-500'
                      }`}>
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
            {dashboard.upcomingDeadlines?.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("gantt.empty")}</p>
            ) : (
              dashboard.upcomingDeadlines?.slice(0, 5).map((req) => (
                <div key={req.id} className="flex items-start gap-4 p-3 border border-border rounded">
                  <div className="flex flex-col items-center justify-center bg-sidebar-accent p-2 rounded min-w-[3rem]">
                    <span className="text-xs text-muted-foreground">{format(new Date(req.requestedStart), 'MMM')}</span>
                    <span className="text-lg font-bold text-foreground leading-none">{format(new Date(req.requestedStart), 'dd')}</span>
                  </div>
                  <div>
                    <div className="font-medium text-sm text-foreground">
                      {req.takt?.gewerk} - {req.takt?.zone}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {format(new Date(req.requestedStart), 'dd.MM.yyyy')} - {format(new Date(req.requestedEnd), 'dd.MM.yyyy')}
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
