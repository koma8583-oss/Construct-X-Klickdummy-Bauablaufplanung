import { ArrowDown, CheckCircle2, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";

async function apiFetch<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

export type CurrentAction =
  | "RESPOND_TO_REQUEST"
  | "DECIDE_RESPONSE"
  | "RESPOND_TO_CHANGE_PROPOSAL"
  | "ANSWER_CLARIFICATION"
  | "RESOLVE_CONSTRAINT"
  | "CONFIRM_READINESS"
  | "NO_ACTION";

export function CurrentActionCard({
  requestId,
  action,
  owner,
  responseRequiredBy,
  onFocus,
}: {
  requestId: string;
  action?: CurrentAction | null;
  owner?: "AG" | "AN" | null;
  responseRequiredBy?: string | null;
  onFocus?: () => void;
}) {
  const { data: coordination } = useQuery({
    queryKey: ["/api/leistungsanfragen", requestId, "coordination"],
    queryFn: () => apiFetch<{
      nextAction?: CurrentAction | null;
      nextActionOwner?: "AG" | "AN" | null;
      responseRequiredBy?: string | null;
    }>(`/api/leistungsanfragen/${requestId}/coordination`),
    enabled: !!requestId,
  });
  const effectiveAction = coordination?.nextAction ?? action;
  const effectiveOwner = coordination?.nextActionOwner ?? owner;
  const effectiveDeadline = coordination?.responseRequiredBy ?? responseRequiredBy;
  const copy: Record<CurrentAction, { label: string; title: string; description: string }> = {
    RESPOND_TO_REQUEST: { label: "Warten auf AN", title: "Leistungsanfrage wird bearbeitet", description: "Die Anfrage wurde übermittelt. Die Antwort des AN steht noch aus." },
    DECIDE_RESPONSE: { label: "Aktion erforderlich", title: "Antwort des AN prüfen", description: "Der AN hat auf die Leistungsanfrage geantwortet." },
    RESPOND_TO_CHANGE_PROPOSAL: { label: "Aktion erforderlich", title: "Terminänderung prüfen", description: "Die Gegenseite hat einen Änderungsvorschlag übermittelt." },
    ANSWER_CLARIFICATION: { label: "Aktion erforderlich", title: "Klärungsfrage beantworten", description: "Die Gegenseite benötigt zusätzliche Informationen." },
    RESOLVE_CONSTRAINT: { label: "Aktion erforderlich", title: "Offenes Risiko bearbeiten", description: "Für diese Leistung besteht ein offenes Ausführungshindernis." },
    CONFIRM_READINESS: { label: "Aktion erforderlich", title: "Ausführungsbereitschaft prüfen", description: "Die Leistung beginnt in Kürze und ist noch nicht vollständig bereit." },
    NO_ACTION: effectiveOwner === "AN"
      ? { label: "Keine Aktion erforderlich", title: "Warten auf den Nachunternehmer", description: "Keine Aktion erforderlich. Anfrage muss durch den Nachunternehmer bearbeitet werden." }
      : { label: "Keine Aktion erforderlich", title: "Leistung ist aktuell abgestimmt", description: "Es liegt derzeit keine Aktion für Sie vor." },
  };
  const resolved = copy[effectiveAction ?? "NO_ACTION"];
  const waiting = resolved.label === "Warten auf AN" || (effectiveOwner && effectiveOwner !== "AG" && effectiveAction === "NO_ACTION");
  return (
    <section className="rounded-xl border border-primary/20 bg-primary/5 p-4 sm:p-5" aria-label="Aktuelle Aufgabe">
      <div className="flex items-start gap-3">
        {waiting ? <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" /> : <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{resolved.label}</p>
          <h2 className="mt-1 text-base font-semibold">{resolved.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{resolved.description}</p>
          {effectiveDeadline && effectiveAction !== "NO_ACTION" && (
            <p className="mt-2 text-xs text-muted-foreground">Antwortfrist: <strong>{new Date(effectiveDeadline).toLocaleDateString("de-DE")}</strong></p>
          )}
          {onFocus && effectiveAction !== "NO_ACTION" && !waiting && (
            <Button size="sm" className="mt-3 min-h-10 gap-2" onClick={onFocus}>
              Öffnen <ArrowDown className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}