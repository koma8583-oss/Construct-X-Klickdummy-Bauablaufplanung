import { useQuery } from "@tanstack/react-query";
import { getProjectCoordinationBoard } from "@workspace/api-client-react";
import { AlertTriangle, CheckCircle2, LayoutDashboard } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function CoordinationBoard({ projectId }: { projectId: string }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ["coordination-board", projectId],
    queryFn: () => getProjectCoordinationBoard(projectId) as Promise<any[]>,
    enabled: !!projectId,
    refetchInterval: 30_000,
  });
  return (
    <Card className="mt-6">
      <CardHeader><CardTitle className="flex items-center gap-2"><LayoutDashboard className="h-5 w-5 text-primary" />Koordinationsübersicht</CardTitle></CardHeader>
      <CardContent>
        {isLoading ? <p className="text-sm text-muted-foreground">Übersicht wird geladen …</p> :
          data.length === 0 ? <p className="text-sm text-muted-foreground">Keine Leistungsanfragen für dieses Projekt.</p> :
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead><tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-2 py-2">Leistung</th><th className="px-2 py-2">AN</th><th className="px-2 py-2">Vereinbarung</th>
                <th className="px-2 py-2">Nächste Aktion</th><th className="px-2 py-2">Risiken</th><th className="px-2 py-2">Klärungen</th><th className="px-2 py-2">Bereitschaft</th>
              </tr></thead>
              <tbody>{data.map((item: any) => <tr key={item.serviceRequestId} className="border-b last:border-0">
                <td className="px-2 py-3"><Link className="font-medium text-primary hover:underline" href={`/leistungsanfragen/${item.serviceRequestId}`}>{item.serviceName}</Link></td>
                <td className="px-2 py-3">{item.partnerName}</td>
                <td className="px-2 py-3">{item.agreedStart ? `${new Date(item.agreedStart).toLocaleDateString("de-DE")} – ${new Date(item.agreedEnd).toLocaleDateString("de-DE")}` : "—"}</td>
                <td className="px-2 py-3">{item.nextAction}</td>
                <td className="px-2 py-3">{item.openConstraintCount > 0 ? <Badge variant="destructive"><AlertTriangle className="mr-1 h-3 w-3" />{item.openConstraintCount}</Badge> : "0"}</td>
                <td className="px-2 py-3">{item.openClarificationCount}</td>
                <td className="px-2 py-3">{item.readinessStatus === "READY" ? <span className="text-emerald-600"><CheckCircle2 className="mr-1 inline h-4 w-4" />Bereit</span> : item.readinessStatus === "NOT_READY" ? <span className="text-amber-600">Nicht bereit</span> : "—"}</td>
              </tr>)}</tbody>
            </table>
          </div>}
      </CardContent>
    </Card>
  );
}