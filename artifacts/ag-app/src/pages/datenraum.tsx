/**
 * Datenraum — AG overview of all data publications across all projects.
 *
 * Shows which data is published for whom, their acceptance status,
 * applicable policy and validity dates.
 */
import { useState, useMemo } from "react";
import { Link } from "wouter";
import {
  Database,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Search,
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
  Loader2,
  FileText,
  Users,
  ShieldCheck,
  Trash2,
  RefreshCw,
} from "lucide-react";
import {
  useGetAllAgDataPublications,
  useDeleteDataPublication,
  useRetryDataPublicationDelivery,
  type AgDataPublication,
  type PublicationStatus,
  type PublicationRecipientStatus,
  type DataPublicationDeliveryStatus,
} from "@workspace/api-client-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { deduplicateDataPublications } from "@/lib/vergabe";

// ── Label maps ────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<PublicationStatus, string> = {
  DRAFT: "Entwurf",
  PUBLISHED: "Veröffentlicht",
  SUSPENDED: "Pausiert",
  WITHDRAWN: "Zurückgezogen",
  EXPIRED: "Abgelaufen",
};

const STATUS_STYLES: Record<PublicationStatus, string> = {
  DRAFT: "text-muted-foreground bg-muted/60 border-border",
  PUBLISHED: "text-emerald-700 bg-emerald-500/10 border-emerald-500/30",
  SUSPENDED: "text-amber-700 bg-amber-500/10 border-amber-500/30",
  WITHDRAWN: "text-red-700 bg-red-500/10 border-red-500/30",
  EXPIRED: "text-muted-foreground bg-muted/40 border-border",
};

const RECIPIENT_STATUS_CONFIG: Record<
  PublicationRecipientStatus,
  { label: string; icon: React.ElementType; cls: string }
> = {
  OFFERED: { label: "Angeboten", icon: Clock, cls: "text-amber-600" },
  ACCEPTED: { label: "Akzeptiert", icon: CheckCircle2, cls: "text-emerald-600" },
  REJECTED: { label: "Abgelehnt", icon: XCircle, cls: "text-red-500" },
  REVOKED: { label: "Widerrufen", icon: AlertTriangle, cls: "text-muted-foreground" },
  EXPIRED: { label: "Abgelaufen", icon: AlertTriangle, cls: "text-muted-foreground" },
};

const PRODUCT_TYPE_LABELS: Record<string, string> = {
  PROJECT_OVERVIEW: "Projektübersicht",
  PROJECT_COORDINATION_PACKAGE: "Koordinationspaket",
  TAKT_INFORMATION_PACKAGE: "Leistungsinformationspaket",
};

const DELIVERY_STATUS_LABELS: Record<DataPublicationDeliveryStatus, string> = {
  PENDING: "ausstehend",
  SENT: "gesendet",
  DELIVERED: "zugestellt",
  READ: "gelesen",
  FAILED: "Zustellung fehlgeschlagen",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "–";
  return new Date(iso).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function fmtValidity(validFrom: string | null | undefined, validUntil: string | null | undefined) {
  if (validFrom && validUntil) return `${fmtDate(validFrom)} – ${fmtDate(validUntil)}`;
  if (validFrom) return `ab ${fmtDate(validFrom)}`;
  if (validUntil) return `bis ${fmtDate(validUntil)}`;
  return "–";
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: PublicationStatus }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLES[status] ?? ""}`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function RecipientStatusIcon({ status }: { status: PublicationRecipientStatus }) {
  const cfg = RECIPIENT_STATUS_CONFIG[status];
  if (!cfg) return null;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${cfg.cls}`} title={cfg.label}>
      <Icon className="w-3.5 h-3.5" />
      {cfg.label}
    </span>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-4">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

// ── Publication row (expandable) ──────────────────────────────────────────────

function PublicationRow({
  pub,
  onDelete,
  onRetry,
  retryPending,
}: {
  pub: AgDataPublication;
  onDelete: (id: string, title: string) => void;
  onRetry: (publicationId: string, anOrgId: string) => void;
  retryPending: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const recipients = pub.recipients ?? [];
  const accepted = recipients.filter((r) => r.status === "ACCEPTED").length;
  const isWithdrawn = pub.status === "WITHDRAWN";
  const isCombinedInvitation = Boolean(pub.projectInvitationId || recipients.some((recipient) => recipient.projectMembershipId));

  return (
    <>
      <tr
        className="border-b border-border hover:bg-muted/20 transition-colors cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      >
        {/* Expand toggle */}
        <td className="px-4 py-3 w-8">
          {recipients.length > 0 ? (
            expanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
            )
          ) : (
            <span className="w-3.5 h-3.5 block" />
          )}
        </td>

        {/* Project */}
        <td className="px-4 py-3 text-sm">
          <Link
            href={`/projects/${pub.projectId}`}
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 text-primary hover:underline font-medium"
          >
            {pub.projectName ?? pub.projectId}
            <ExternalLink className="w-3 h-3 flex-shrink-0" />
          </Link>
        </td>

        {/* Title + product type */}
        <td className="px-4 py-3">
          <div className="text-sm font-medium">{pub.title}</div>
          <div className="text-xs text-muted-foreground">
            {PRODUCT_TYPE_LABELS[pub.dataProductType] ?? pub.dataProductType}
            {isCombinedInvitation && <span className="ml-1.5 text-primary">· Einladung &amp; Freigabe</span>}
          </div>
        </td>

        {/* Status */}
        <td className="px-4 py-3">
          <StatusBadge status={pub.status} />
        </td>

        {/* Recipients summary */}
        <td className="px-4 py-3">
          {recipients.length === 0 ? (
            <span className="text-xs text-muted-foreground">–</span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-sm">
              <Users className="w-3.5 h-3.5 text-muted-foreground" />
              <span>
                {recipients.length} NU
                {accepted > 0 && (
                  <span className="text-emerald-600 ml-1">({accepted} ✓)</span>
                )}
              </span>
            </span>
          )}
        </td>

        {/* Policy */}
        <td className="px-4 py-3">
          {pub.policyName ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <ShieldCheck className="w-3.5 h-3.5" />
              {pub.policyName}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">–</span>
          )}
        </td>

        {/* Validity */}
        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
          {fmtValidity(pub.validFrom, pub.validUntil)}
        </td>

        {/* Actions */}
        <td className="px-4 py-3 w-12 text-right">
          {isWithdrawn && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(pub.id, pub.title);
              }}
              className="inline-flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              title="Publikation endgültig löschen"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </td>
      </tr>

      {/* Expanded: complete publication detail */}
      {expanded && (
        <tr className="border-b border-border bg-muted/10">
          <td colSpan={8} className="px-8 py-3">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-3">
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                    Informationspaket
                  </div>
                  <p className="text-sm font-medium">{pub.title}</p>
                  {pub.description && (
                    <p className="text-sm text-muted-foreground mt-1">{pub.description}</p>
                  )}
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <div><dt className="text-muted-foreground">Projekt</dt><dd className="font-medium">{pub.projectName ?? pub.projectId}</dd></div>
                  <div><dt className="text-muted-foreground">Datentyp</dt><dd className="font-medium">{PRODUCT_TYPE_LABELS[pub.dataProductType] ?? pub.dataProductType}</dd></div>
                  <div><dt className="text-muted-foreground">Version</dt><dd className="font-medium">v{pub.version} · Schema {pub.schemaVersion}</dd></div>
                  <div><dt className="text-muted-foreground">Status</dt><dd className="font-medium"><StatusBadge status={pub.status} /></dd></div>
                  <div><dt className="text-muted-foreground">Gültigkeit</dt><dd className="font-medium">{fmtValidity(pub.validFrom, pub.validUntil)}</dd></div>
                  <div><dt className="text-muted-foreground">Erstellt</dt><dd className="font-medium">{fmtDate(pub.createdAt)}</dd></div>
                  <div><dt className="text-muted-foreground">Veröffentlicht</dt><dd className="font-medium">{fmtDate(pub.publishedAt)}</dd></div>
                </dl>
              </div>

              <div className="space-y-3">
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                    Richtlinie
                  </div>
                  <p className="text-sm font-medium">{pub.policyName ?? "–"}</p>
                  {pub.policyCode && <p className="text-xs text-muted-foreground">{pub.policyCode}</p>}
                </div>
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                    Bereitgestellte Inhalte
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(pub.selectedFields ?? []).map((field) => (
                      <span key={field} className="rounded-md border border-border bg-card px-2 py-1 text-xs">
                        {field}
                      </span>
                    ))}
                    {(pub.selectedFields ?? []).length === 0 && <span className="text-xs text-muted-foreground">Keine Felder angegeben</span>}
                  </div>
                  {pub.selectedTaktIds && pub.selectedTaktIds.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-2">{pub.selectedTaktIds.length} Leistungen enthalten</p>
                  )}
                </div>
                {pub.contentHash && (
                  <p className="text-[10px] text-muted-foreground break-all">Integritäts-Hash: {pub.contentHash}</p>
                )}
              </div>
            </div>

            {recipients.length > 0 && (
              <div className="mt-4 pt-3 border-t border-border/60">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Empfänger
                </div>
                <div className="flex flex-wrap gap-3">
                  {recipients.map((r) => (
                    <div
                      key={r.anOrgId}
                      className="bg-card border border-border rounded-lg px-3 py-2 flex flex-col gap-0.5 min-w-[200px]"
                      data-testid={`datenraum-recipient-${pub.id}-${r.anOrgId}`}
                    >
                      <div className="text-sm font-medium">{r.anName}</div>
                      <RecipientStatusIcon status={r.status} />
                      {r.delivery && (
                        <div
                          className={`text-xs ${r.delivery.status === "FAILED" ? "text-red-600" : r.delivery.status === "DELIVERED" ? "text-emerald-600" : "text-muted-foreground"}`}
                          data-testid={`datenraum-delivery-status-${pub.id}-${r.anOrgId}`}
                        >
                          Datenangebot: {DELIVERY_STATUS_LABELS[r.delivery.status] ?? r.delivery.status}
                          {" "}({r.delivery.attemptCount}/5 Versuche)
                        </div>
                      )}
                      {r.delivery?.failureReason && (
                        <div className="text-xs text-red-600 break-words">
                          Fehlergrund: {r.delivery.failureReason}
                        </div>
                      )}
                      {r.delivery?.status === "FAILED" && r.delivery.attemptCount < 5 && (
                        <button
                          type="button"
                          className="mt-2 inline-flex h-7 items-center self-start rounded-md border border-border px-2 text-xs font-medium hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
                          data-testid={`datenraum-retry-${pub.id}-${r.anOrgId}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            onRetry(pub.id, r.anOrgId);
                          }}
                          disabled={retryPending}
                        >
                          <RefreshCw className={`mr-1 h-3 w-3 ${retryPending ? "animate-spin" : ""}`} />
                          Erneut zustellen
                        </button>
                      )}
                      {r.projectMembershipId && r.status === "OFFERED" && (
                        <div className="text-xs text-amber-600">Wartet auf Einladung &amp; Policy</div>
                      )}
                      {r.policyAcceptedAt && <div className="text-xs text-muted-foreground">Akzeptiert: {fmtDate(r.policyAcceptedAt)}</div>}
                      {r.firstAccessedAt && <div className="text-xs text-muted-foreground">Erster Zugriff: {fmtDate(r.firstAccessedAt)}</div>}
                      {r.policyRejectedAt && <div className="text-xs text-red-500">Abgelehnt: {fmtDate(r.policyRejectedAt)}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ── Filter bar ────────────────────────────────────────────────────────────────

const ALL_STATUSES: (PublicationStatus | "ALL")[] = [
  "ALL",
  "PUBLISHED",
  "DRAFT",
  "SUSPENDED",
  "WITHDRAWN",
  "EXPIRED",
];

const STATUS_FILTER_LABELS: Record<PublicationStatus | "ALL", string> = {
  ALL: "Alle",
  ...STATUS_LABELS,
};

// ── Page ─────────────────────────────────────────────────────────────────────

export default function DatenraumPage() {
  const { data: publications, isLoading, isError } = useGetAllAgDataPublications();
  const deletePublication = useDeleteDataPublication();
  const retryDataPublicationDelivery = useRetryDataPublicationDelivery();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<PublicationStatus | "ALL">("ALL");
  const [projectFilter, setProjectFilter] = useState<string>("ALL");

  // Delete confirmation dialog state
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);

  const pubs = useMemo(
    () => deduplicateDataPublications(publications ?? []),
    [publications],
  );

  // Unique projects for filter
  const projects = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of pubs) {
      if (!seen.has(p.projectId)) seen.set(p.projectId, p.projectName ?? p.projectId);
    }
    return Array.from(seen.entries());
  }, [pubs]);

  // Summary stats
  const stats = useMemo(
    () => ({
      total: pubs.length,
      published: pubs.filter((p) => p.status === "PUBLISHED").length,
      draft: pubs.filter((p) => p.status === "DRAFT").length,
      recipients: new Set(
        pubs.flatMap((p) => (p.recipients ?? []).map((r) => r.anOrgId)),
      ).size,
    }),
    [pubs],
  );

  // Filtered list
  const filtered = useMemo(() => {
    return pubs.filter((p) => {
      if (statusFilter !== "ALL" && p.status !== statusFilter) return false;
      if (projectFilter !== "ALL" && p.projectId !== projectFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const match =
          p.title.toLowerCase().includes(q) ||
          (p.projectName ?? "").toLowerCase().includes(q) ||
          (p.policyName ?? "").toLowerCase().includes(q) ||
          (p.recipients ?? []).some((r) => r.anName.toLowerCase().includes(q));
        if (!match) return false;
      }
      return true;
    });
  }, [pubs, statusFilter, projectFilter, search]);

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await deletePublication.mutateAsync(deleteTarget.id);
      toast({ title: "Publikation gelöscht", description: deleteTarget.title });
    } catch (err) {
      toast({
        title: "Fehler beim Löschen",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleRetryDataPublicationDelivery = (publicationId: string, anOrgId: string) => {
    retryDataPublicationDelivery.mutate({ publicationId, anOrgId }, {
      onSuccess: (result) => {
        if (result.status === "FAILED") {
          toast({
            title: "Datenangebot konnte nicht zugestellt werden",
            description: `${result.error?.message ?? "Die Zustellung ist fehlgeschlagen."} Bitte beheben Sie das externe Problem und versuchen Sie es erneut.`,
            variant: "destructive",
          });
          return;
        }
        toast({ title: "Datenangebot erneut zugestellt" });
      },
      onError: (err) => {
        toast({
          title: "Datenangebot konnte nicht erneut zugestellt werden",
          description: err.message,
          variant: "destructive",
        });
      },
    });
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Database className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Datenraum</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Übersicht aller Datenpublikationen — welche Daten für wen verfügbar sind.
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard
          icon={FileText}
          label="Publikationen gesamt"
          value={stats.total}
          color="text-primary bg-primary/10"
        />
        <SummaryCard
          icon={CheckCircle2}
          label="Aktiv veröffentlicht"
          value={stats.published}
          color="text-emerald-600 bg-emerald-500/10"
        />
        <SummaryCard
          icon={Clock}
          label="Im Entwurf"
          value={stats.draft}
          color="text-amber-600 bg-amber-500/10"
        />
        <SummaryCard
          icon={Users}
          label="Empfänger (NU)"
          value={stats.recipients}
          color="text-blue-600 bg-blue-500/10"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Suchen …"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-9 pl-9 pr-3 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Status filter */}
        <div className="flex items-center gap-1 flex-wrap">
          {ALL_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={[
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors border",
                statusFilter === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:bg-muted/50",
              ].join(" ")}
            >
              {STATUS_FILTER_LABELS[s]}
            </button>
          ))}
        </div>

        {/* Project filter */}
        {projects.length > 1 && (
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="h-9 px-3 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
          >
            <option value="ALL">Alle Projekte</option>
            {projects.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex justify-center py-24">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center gap-3 py-24">
          <AlertTriangle className="w-8 h-8 text-destructive" />
          <p className="text-muted-foreground text-sm">Fehler beim Laden der Datenraum-Publikationen.</p>
        </div>
      ) : pubs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4 border border-dashed border-border rounded-xl">
          <Database className="w-12 h-12 text-muted-foreground opacity-30" />
          <div className="text-center">
            <p className="font-medium text-muted-foreground">Noch keine Datenpublikationen</p>
            <p className="text-sm text-muted-foreground mt-1">
              Datenpublikationen werden in der Projektdetailansicht erstellt.
            </p>
          </div>
          <Link href="/projects">
            <button className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
              Zu den Projekten
            </button>
          </Link>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 border border-dashed border-border rounded-xl">
          <Search className="w-8 h-8 text-muted-foreground opacity-40" />
          <p className="text-muted-foreground text-sm">Keine Publikationen für diesen Filter.</p>
          <button
            className="text-xs text-primary hover:underline"
            onClick={() => { setSearch(""); setStatusFilter("ALL"); setProjectFilter("ALL"); }}
          >
            Filter zurücksetzen
          </button>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="w-8 px-4 py-3" />
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Projekt
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Publikation
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Empfänger
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Richtlinie
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Gültig
                  </th>
                  <th className="w-12 px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((pub) => (
                  <PublicationRow
                    key={pub.id}
                    pub={pub}
                    onDelete={(id, title) => setDeleteTarget({ id, title })}
                    onRetry={handleRetryDataPublicationDelivery}
                    retryPending={retryDataPublicationDelivery.isPending}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 border-t border-border bg-muted/10 text-xs text-muted-foreground">
            {filtered.length} von {pubs.length} Publikationen
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="w-4 h-4" />
              Publikation endgültig löschen?
            </AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">„{deleteTarget?.title}"</span> wird
              unwiderruflich gelöscht — einschließlich aller Empfängerdaten. Diese Aktion kann
              nicht rückgängig gemacht werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deletePublication.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletePublication.isPending ? (
                <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Wird gelöscht…</>
              ) : (
                "Endgültig löschen"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
