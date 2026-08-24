import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getServiceConstraints, getServiceClarifications, getServiceReadiness } from "@workspace/api-client-react";
import { AlertTriangle, CheckCircle2, HelpCircle, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useState } from "react";

export function ServiceCoordinationTools({ requestId, role }: { requestId: string; role: "AG" | "AN" }) {
  const client = useQueryClient();
  const constraints = useQuery({ queryKey: ["constraints", requestId], queryFn: () => getServiceConstraints(requestId) as Promise<any[]> });
  const clarifications = useQuery({ queryKey: ["clarifications", requestId], queryFn: () => getServiceClarifications(requestId) as Promise<any[]> });
  const readiness = useQuery({ queryKey: ["readiness", requestId], queryFn: () => getServiceReadiness(requestId) as Promise<any> });
  const check = readiness.data;
  const [error, setError] = useState<string | null>(null);
  const update = async (field: string, value: boolean) => {
    setError(null);
    try {
      const response = await fetch(`/api/service-requests/${requestId}/readiness`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [field]: value }) });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Die Bereitschaft konnte nicht gespeichert werden.");
      await client.invalidateQueries({ queryKey: ["readiness", requestId] });
      await client.invalidateQueries({ queryKey: [`/api/leistungsanfragen/${requestId}`] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Die Bereitschaft konnte nicht gespeichert werden.");
    }
  };
  const openConstraints = (constraints.data ?? []).filter((row) => row.status === "OPEN");
  const openClarifications = (clarifications.data ?? []).filter((row) => row.status === "OPEN");
  const fields: Array<[string, string, boolean]> = role === "AG"
    ? [["scheduleConfirmed", "Termin bestätigt", true], ["siteReady", "Arbeitsbereich bereit", true], ["informationComplete", "Informationen vollständig", true], ["agReady", "AG bereit", true], ["anReady", "AN bereit", false]]
    : [["anReady", "AN bereit", true]];
  return (
    <Card className="border-primary/20">
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4 text-primary" />Koordinationsstatus</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="mb-2 text-sm font-medium">Ausführungsbereitschaft</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {fields.map(([field, label, editable]) => <label key={field} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={Boolean(check?.[field])} disabled={!editable} onChange={(event) => void update(field, event.target.checked)} />
              {check?.[field] ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-amber-500" />}
              {label}
            </label>)}
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <p className={`mt-2 text-sm font-medium ${check?.status === "READY" ? "text-emerald-600" : "text-amber-600"}`}>
            {check?.status === "READY" ? "Bereit zur Ausführung" : "Noch nicht ausführungsbereit"}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border p-3">
            <p className="flex items-center gap-2 text-sm font-medium"><AlertTriangle className="h-4 w-4 text-amber-500" />Offene Risiken</p>
            <p className="mt-1 text-2xl font-semibold">{openConstraints.length}</p>
            {openConstraints[0] && <p className="mt-1 text-xs text-muted-foreground">{openConstraints[0].description}</p>}
          </div>
          <div className="rounded-lg border p-3">
            <p className="flex items-center gap-2 text-sm font-medium"><HelpCircle className="h-4 w-4 text-blue-500" />Offene Klärungen</p>
            <p className="mt-1 text-2xl font-semibold">{openClarifications.length}</p>
            {openClarifications[0] && <p className="mt-1 text-xs text-muted-foreground">{openClarifications[0].question}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}