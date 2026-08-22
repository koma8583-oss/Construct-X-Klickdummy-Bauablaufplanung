import { ArrowDown, CheckCircle2, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";

async function apiFetch<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

type CurrentAction =
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
  const copy: Record<CurrentAction, [string, string, string]> = {
    RESPOND_TO_REQUEST: ["Aktion erforderlich", "Leistungsanfrage beantworten", "Der AG erwartet Ihre Rückmeldung zur angefragten Leistung."],
    DECIDE_RESPONSE: ["Warten auf AG", "Antwort wurde übermittelt", "Der AG muss die Abstimmung noch abschließen."],
    RESPOND_TO_CHANGE_PROPOSAL: ["Aktion erforderlich", "Terminänderung prüfen", "Die Gegenseite hat einen Änderungsvorschlag übermittelt."],
    ANSWER_CLARIFICATION: ["Aktion erforderlich", "Klärungsfrage beantworten", "Die Gegenseite benötigt zusätzliche Informationen."],
    RESOLVE_CONSTRAINT: ["Aktion erforderlich", "Offenes Risiko bearbeiten", "Für diese Leistung besteht ein offenes Ausführungshindernis."],
    CONFIRM_READINESS: ["Aktion erforderlich", "Ausführungsbereitschaft prüfen", "Die Leistung beginnt in Kürze und ist noch nicht vollständig bereit."],
    NO_ACTION: ["Keine Aktion erforderlich", "Leistung ist aktuell abgestimmt", "Es liegt derzeit keine Aktion für Sie vor."],
  };
  const [label, title, description] = copy[effectiveAction ?? "NO_ACTION"];
  const waiting = label === "Warten auf AG" || (effectiveOwner && effectiveOwner !== "AN" && effectiveAction === "NO_ACTION");
  return (
    <section className="rounded-xl border border-primary/20 bg-primary/5 p-4 sm:p-5" aria-label="Aktuelle Aufgabe">
      <div className="flex items-start gap-3">
        {waiting ? <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" /> : <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
          <h2 className="mt-1 text-base font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          {effectiveDeadline && effectiveAction === "RESPOND_TO_REQUEST" && (
            <p className="mt-2 text-xs text-muted-foreground">Antwort bis: <strong>{new Date(effectiveDeadline).toLocaleDateString("de-DE")}</strong></p>
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