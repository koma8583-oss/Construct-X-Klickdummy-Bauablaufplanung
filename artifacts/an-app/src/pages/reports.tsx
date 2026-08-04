/**
 * Berichte — AN-App reports page.
 * Route: /reports
 * Displays KPI cards fetched from /api/reports/an/summary.
 */
import { BarChart2, Clock, AlertTriangle, CheckCircle2, Package } from "lucide-react";
import { useGetAnReportSummary } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function ReportsPage() {
  const { data: summary, isLoading, isError } = useGetAnReportSummary({
    query: { refetchInterval: 60_000, staleTime: 30_000 },
  });

  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto animate-in fade-in duration-300">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">Berichte</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            KPIs und Auswertungen für Ihr Unternehmen
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (isError || !summary) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">Berichte</h1>
        </div>
        <div className="text-center py-16 text-muted-foreground">
          Daten konnten nicht geladen werden.
        </div>
      </div>
    );
  }

  const kpis = [
    {
      title: "Offene Anfragen",
      value: summary.openTaktRequests,
      icon: Clock,
      color: "text-blue-500",
      description: "Aktive Taktanfragen",
    },
    {
      title: "Bald fällig",
      value: summary.dueSoonTaktRequests,
      icon: AlertTriangle,
      color: "text-amber-500",
      description: "Fällig in 24 Stunden",
    },
    {
      title: "Überfällig",
      value: summary.overdueTaktRequests,
      icon: AlertTriangle,
      color: "text-destructive",
      description: "Antwortfrist überschritten",
    },
    {
      title: "Aktive Buchungen",
      value: summary.activeResourceBookings,
      icon: Package,
      color: "text-emerald-500",
      description: "Ressourcenbuchungen",
    },
  ];

  const responseSummary = [
    { label: "Akzeptiert", value: summary.acceptedResponses, color: "text-emerald-600" },
    { label: "Alternativen", value: summary.alternativeResponses, color: "text-amber-600" },
    { label: "Abgelehnt", value: summary.rejectedResponses, color: "text-red-600" },
  ];

  return (
    <div className="p-6 max-w-4xl mx-auto animate-in fade-in duration-300">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Berichte</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          KPIs und Auswertungen für Ihr Unternehmen
        </p>
      </div>

      {/* Main KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {kpis.map((kpi, i) => (
          <Card key={i} className="relative overflow-hidden">
            <div className={`absolute top-0 right-0 p-3 opacity-10 ${kpi.color}`}>
              <kpi.icon className="w-12 h-12" />
            </div>
            <CardHeader className="pb-2 relative z-10">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {kpi.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="relative z-10">
              <div className={`text-3xl font-bold ${kpi.color}`}>{kpi.value}</div>
              <p className="text-xs text-muted-foreground mt-1">{kpi.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Response summary + resource cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              Antworten nach Entscheidung
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {responseSummary.map((item) => (
                <div key={item.label} className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{item.label}</span>
                  <span className={`text-lg font-bold ${item.color}`}>{item.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="w-4 h-4 text-primary" />
              Ressourcen
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Aktive Ressourcen</span>
                <span className="text-lg font-bold">{summary.activeResources}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Aktive Buchungen</span>
                <span className="text-lg font-bold text-emerald-600">{summary.activeResourceBookings}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
