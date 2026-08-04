/**
 * Verfügbarkeitsprüfungen — NU-only page.
 * Route: /availability-checks
 *
 * Lets the AN select a TaktRequest from their inbox, view the latest
 * availability check result, run a new check, and inspect both the
 * internal (full conflict detail + resource info) and external-safe
 * (decision, reasonCode, alternatives only) result panels side by side.
 *
 * Privacy invariant: this page never sends the internalResult to the AG.
 * The "Externe Ansicht" panel previews exactly what the AG would see,
 * with a privacy banner confirming no internal data is included.
 */
import { useState } from "react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import {
  useListTaktRequests,
  useGetLatestAvailabilityCheck,
  useRunAvailabilityCheck,
  getListTaktRequestsQueryKey,
  getGetLatestAvailabilityCheckQueryKey,
  type TaktRequestListItem,
  type AvailabilityCheckResponse,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ShieldCheck,
  Play,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Lock,
  Eye,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

// ── Helpers ─────────────────────────────────────────────────────────────────────

function fmtDt(s?: string | null): string {
  if (!s) return "–";
  try { return format(new Date(s), "dd.MM.yyyy HH:mm", { locale: de }); } catch { return s; }
}

const RESULT_STYLES: Record<string, { color: string; label: string; Icon: React.FC<{ className?: string }> }> = {
  FEASIBLE:                 { color: "text-emerald-600", label: "Machbar",                     Icon: CheckCircle2 },
  FEASIBLE_WITH_ALTERNATIVES: { color: "text-amber-600", label: "Machbar mit Alternativen",   Icon: AlertTriangle },
  NOT_FEASIBLE:             { color: "text-red-600",     label: "Nicht machbar",               Icon: XCircle },
};

const CHECK_STATUS_STYLES: Record<string, { color: string; label: string }> = {
  RUNNING:   { color: "text-blue-600",          label: "Läuft…" },
  COMPLETED: { color: "text-emerald-600",        label: "Abgeschlossen" },
  FAILED:    { color: "text-red-600",            label: "Fehlgeschlagen" },
  PENDING:   { color: "text-muted-foreground",   label: "Ausstehend" },
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT:                 "Entwurf",
  SENT:                  "Gesendet",
  DELIVERED:             "Zugestellt",
  DETAILS_RETRIEVED:     "Abgerufen",
  UNDER_REVIEW:          "In Prüfung",
  ACCEPTED:              "Angenommen",
  ALTERNATIVES_PROPOSED: "Gegenvorschlag",
  REJECTED:              "Abgelehnt",
  EXPIRED:               "Abgelaufen",
  CANCELLED:             "Storniert",
  SUPERSEDED:            "Ersetzt",
};

// ── Internal result panel ──────────────────────────────────────────────────────

function InternalResultPanel({ check }: { check: AvailabilityCheckResponse }) {
  const [expanded, setExpanded] = useState(true);

  if (!check.internalResult) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <AlertTriangle className="w-4 h-4" />
        Kein internes Ergebnis verfügbar
      </div>
    );
  }

  const internal = check.internalResult as Record<string, unknown>;
  const conflicts = (internal.conflicts as any[]) ?? [];
  const availableResources = (internal.availableResources as any[]) ?? [];
  const missingQuals = (internal.missingQualifications as string[]) ?? [];
  const tentativeWarnings = (internal.tentativeWarnings as any[]) ?? [];
  const errorMessage = internal.errorMessage as string | undefined;

  return (
    <div className="space-y-4">
      <button
        className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        Interne Details (nur AN-sichtbar)
      </button>

      {expanded && (
        <div className="space-y-3 pl-1">
          {errorMessage && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-700">
              <strong>Technischer Fehler:</strong> {errorMessage}
            </div>
          )}

          {/* Konflikte */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Konflikte ({conflicts.length})
            </h4>
            {conflicts.length === 0 ? (
              <p className="text-xs text-muted-foreground">Keine Konflikte</p>
            ) : (
              <div className="space-y-1.5">
                {conflicts.map((c: any, i: number) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 text-sm p-2 rounded-lg bg-red-500/8 border border-red-500/15"
                  >
                    <XCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 flex-shrink-0" />
                    <div className="min-w-0">
                      <span className="font-medium">{c.resourceName ?? c.resourceId}</span>
                      <span className="text-muted-foreground ml-2 text-xs">{c.conflictType}</span>
                      {c.overlapUtilizationSum !== undefined && (
                        <span className="text-red-600 ml-2 text-xs">
                          (bereits {c.overlapUtilizationSum}% belegt)
                        </span>
                      )}
                      {c.missingQualification && (
                        <p className="text-xs text-muted-foreground mt-0.5">{c.missingQualification}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Verfügbare Ressourcen */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Verfügbare Ressourcen ({availableResources.length})
            </h4>
            {availableResources.length === 0 ? (
              <p className="text-xs text-muted-foreground">Keine verfügbaren Ressourcen</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {availableResources.map((r: any, i: number) => (
                  <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 font-mono">
                    {r.resourceId.slice(0, 8)}… ({r.resourceType})
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Vorläufige Warnungen */}
          {tentativeWarnings.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Vorläufige Überschneidungen ({tentativeWarnings.length})
              </h4>
              <div className="space-y-1">
                {tentativeWarnings.map((w: any, i: number) => (
                  <div key={i} className="text-xs text-amber-700 bg-amber-500/8 px-2 py-1 rounded">
                    Ressource {w.resourceId?.slice(0, 8)}… — {fmtDt(w.overlapStart)} bis {fmtDt(w.overlapEnd)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fehlende Qualifikationen */}
          {missingQuals.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Fehlende Qualifikationen
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {missingQuals.map((q, i) => (
                  <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700">{q}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── External (public) result panel ─────────────────────────────────────────────

function ExternalResultPanel({ check }: { check: AvailabilityCheckResponse }) {
  const pub = check.publicResult;

  return (
    <div className="space-y-4">
      {/* Privacy banner */}
      <div className="flex items-start gap-2.5 p-3 rounded-lg bg-emerald-500/8 border border-emerald-500/20 text-sm">
        <ShieldCheck className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
        <div>
          <span className="font-medium text-emerald-700">Datenschutz-Vorschau</span>
          <p className="text-xs text-muted-foreground mt-0.5">
            Die Auftraggeber-Antwort enthält ausschließlich die unten gezeigten Felder.
            Ressourcen-IDs, lokale Projektnummern, Mitarbeiternamen und Kundenkürzel
            werden niemals weitergegeben.
          </p>
        </div>
      </div>

      {!pub ? (
        <div className="text-sm text-muted-foreground py-4 text-center">
          Kein öffentliches Ergebnis verfügbar
        </div>
      ) : (
        <div className="space-y-3">
          <div className="p-3 rounded-lg bg-muted/40 space-y-0.5">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Ergebnis</p>
              <p className="text-sm font-semibold">
                {pub.result === "FEASIBLE" ? "Machbar" :
                 pub.result === "FEASIBLE_WITH_ALTERNATIVES" ? "Machbar mit Alternativen" :
                 pub.result === "NOT_FEASIBLE" ? "Nicht machbar" : pub.result}
              </p>
            </div>

          {pub.alternatives && pub.alternatives.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Alternativen ({pub.alternatives.length})
              </h4>
              <div className="space-y-2">
                {pub.alternatives.map((alt, i) => (
                  <div key={i} className="p-2.5 rounded-lg border border-border bg-card text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">Alternative #{alt.rank}</span>
                      <span className="text-xs font-mono text-muted-foreground">{alt.alternativeId}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {fmtDt(alt.timeWindow?.start)} – {fmtDt(alt.timeWindow?.end)}
                    </div>
                    {alt.crewSize && (
                      <div className="text-xs text-muted-foreground">Kapazität: {alt.crewSize}</div>
                    )}
                    {alt.conditions && alt.conditions.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {alt.conditions.map((c, ci) => (
                          <span key={ci} className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{c}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Confirm no forbidden fields */}
          <div className="p-2.5 rounded-lg border border-dashed border-emerald-500/30 bg-emerald-500/5">
            <p className="text-xs text-emerald-700 font-medium flex items-center gap-1.5">
              <Lock className="w-3 h-3" />
              Folgende Felder sind in dieser Ansicht NICHT enthalten:
            </p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              resourceId · localProjectId · internalResultPayload · employeeId ·
              localProjectCode · customerAlias · resourceName · internalConflicts ·
              availableResources · tentativeWarnings
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Check result card ──────────────────────────────────────────────────────────

function CheckResultCard({
  check,
  onRerun,
  isRerunning,
}: {
  check: AvailabilityCheckResponse;
  onRerun: () => void;
  isRerunning: boolean;
}) {
  const resultMeta = check.result ? RESULT_STYLES[check.result] : undefined;
  const statusMeta = CHECK_STATUS_STYLES[check.status] ?? { color: "text-muted-foreground", label: check.status };

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          {resultMeta && (
            <div className={`flex items-center gap-1.5 ${resultMeta.color}`}>
              <resultMeta.Icon className="w-5 h-5" />
              <span className="font-semibold text-sm">{resultMeta.label}</span>
            </div>
          )}
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full bg-muted ${statusMeta.color}`}>
            {statusMeta.label}
          </span>
          {check.checkedAt && (
            <span className="text-xs text-muted-foreground">
              Geprüft: {fmtDt(check.checkedAt)}
            </span>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={onRerun}
          disabled={isRerunning}
          className="h-8"
        >
          {isRerunning ? (
            <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
          ) : (
            <Play className="w-4 h-4 mr-1.5" />
          )}
          Neue Prüfung starten
        </Button>
      </div>

      {/* Two-panel layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Internal panel */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Lock className="w-4 h-4 text-muted-foreground" />
              Interne Sicht
              <span className="text-xs font-normal text-muted-foreground">(nur AN)</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <InternalResultPanel check={check} />
          </CardContent>
        </Card>

        {/* External panel */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Eye className="w-4 h-4 text-emerald-600" />
              Externe Ansicht
              <span className="text-xs font-normal text-muted-foreground">(AG-Vorschau)</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <ExternalResultPanel check={check} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function AvailabilityChecksPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedRequestId, setSelectedRequestId] = useState<string>("");

  const listParams = { role: "nu" } as any;
  const { data: allRequests, isLoading: reqLoading } = useListTaktRequests(
    listParams,
    { query: { queryKey: getListTaktRequestsQueryKey(listParams), refetchInterval: false } },
  );

  // Only show requests that are in a checkable status
  const checkableRequests = (allRequests ?? []).filter((r) =>
    ["DELIVERED", "DETAILS_RETRIEVED", "UNDER_REVIEW"].includes(r.status),
  );

  const selectedRequest = checkableRequests.find((r) => r.id === selectedRequestId) ??
    (allRequests ?? []).find((r) => r.id === selectedRequestId);

  const {
    data: latestCheck,
    isLoading: checkLoading,
    isError: checkError,
    refetch: refetchCheck,
  } = useGetLatestAvailabilityCheck(selectedRequestId, {
    query: {
      queryKey: getGetLatestAvailabilityCheckQueryKey(selectedRequestId),
      enabled: !!selectedRequestId,
      retry: 1,
    },
  });

  const runMutation = useRunAvailabilityCheck();
  const [isRerunning, setIsRerunning] = useState(false);

  const handleRunCheck = async () => {
    if (!selectedRequestId) return;
    setIsRerunning(true);
    try {
      await runMutation.mutateAsync({ requestId: selectedRequestId });
      await refetchCheck();
      queryClient.invalidateQueries({ queryKey: getGetLatestAvailabilityCheckQueryKey(selectedRequestId) });
      toast({ title: "Verfügbarkeitsprüfung abgeschlossen" });
    } catch (err: any) {
      toast({
        title: "Fehler",
        description: err?.message ?? "Prüfung fehlgeschlagen",
        variant: "destructive",
      });
    } finally {
      setIsRerunning(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto animate-in fade-in duration-300">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Verfügbarkeitsprüfungen</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Prüfung und Datenschutz-Vorschau für TaktAnfragen
        </p>
      </div>

      {/* TaktRequest selector */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium">TaktAnfrage auswählen</label>
        <div className="flex gap-3 items-center flex-wrap">
          <Select
            value={selectedRequestId}
            onValueChange={setSelectedRequestId}
            disabled={reqLoading}
          >
            <SelectTrigger className="h-9 w-full max-w-lg text-sm">
              {reqLoading ? (
                <span className="text-muted-foreground flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Lädt…
                </span>
              ) : (
                <SelectValue placeholder="Anfrage wählen…" />
              )}
            </SelectTrigger>
            <SelectContent>
              {checkableRequests.length > 0 && (
                <>
                  <div className="px-2 py-1 text-xs text-muted-foreground font-medium">Prüfbar</div>
                  {checkableRequests.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      <span className="font-mono text-xs mr-2 text-muted-foreground">{r.requestNumber}</span>
                      {r.taktBezeichnung} — {STATUS_LABELS[r.status] ?? r.status}
                    </SelectItem>
                  ))}
                </>
              )}
              {(allRequests ?? []).filter((r) => !checkableRequests.includes(r)).length > 0 && (
                <>
                  <div className="px-2 py-1 text-xs text-muted-foreground font-medium mt-1">Andere</div>
                  {(allRequests ?? []).filter((r) => !checkableRequests.includes(r)).slice(0, 20).map((r) => (
                    <SelectItem key={r.id} value={r.id} className="opacity-60">
                      <span className="font-mono text-xs mr-2">{r.requestNumber}</span>
                      {r.taktBezeichnung} — {STATUS_LABELS[r.status] ?? r.status}
                    </SelectItem>
                  ))}
                </>
              )}
              {(allRequests ?? []).length === 0 && (
                <div className="px-2 py-2 text-xs text-muted-foreground">Keine TaktAnfragen vorhanden</div>
              )}
            </SelectContent>
          </Select>

          {selectedRequest && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="w-3.5 h-3.5" />
              <span>{STATUS_LABELS[selectedRequest.status] ?? selectedRequest.status}</span>
            </div>
          )}
        </div>
      </div>

      {/* Check panel */}
      {!selectedRequestId ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 border border-dashed rounded-xl">
          <ShieldCheck className="w-12 h-12 text-muted-foreground opacity-40" />
          <p className="font-medium text-muted-foreground">Bitte eine TaktAnfrage auswählen</p>
          <p className="text-xs text-muted-foreground max-w-xs text-center">
            Wählen Sie oben eine Anfrage, um die Verfügbarkeitsprüfung zu starten oder das letzte Ergebnis anzuzeigen.
          </p>
        </div>
      ) : checkLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-7 h-7 animate-spin text-primary" />
        </div>
      ) : checkError ? (
        /* No check run yet */
        <div className="flex flex-col items-center justify-center py-16 gap-4 border border-dashed rounded-xl">
          <ShieldCheck className="w-10 h-10 text-muted-foreground opacity-40" />
          <p className="text-muted-foreground text-sm">Noch keine Prüfung für diese Anfrage</p>
          <Button
            size="sm"
            onClick={handleRunCheck}
            disabled={isRerunning}
            className="bg-emerald-500 hover:bg-emerald-600 text-white"
          >
            {isRerunning ? (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            ) : (
              <Play className="w-4 h-4 mr-1.5" />
            )}
            Erste Prüfung starten
          </Button>
        </div>
      ) : latestCheck ? (
        <CheckResultCard
          check={latestCheck}
          onRerun={handleRunCheck}
          isRerunning={isRerunning}
        />
      ) : (
        <div className="flex flex-col items-center justify-center py-16 gap-4 border border-dashed rounded-xl">
          <Clock className="w-10 h-10 text-muted-foreground opacity-40" />
          <p className="text-muted-foreground text-sm">Noch keine Prüfung durchgeführt</p>
          <Button
            size="sm"
            onClick={handleRunCheck}
            disabled={isRerunning}
            className="bg-emerald-500 hover:bg-emerald-600 text-white"
          >
            {isRerunning ? (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            ) : (
              <Play className="w-4 h-4 mr-1.5" />
            )}
            Prüfung starten
          </Button>
        </div>
      )}
    </div>
  );
}
