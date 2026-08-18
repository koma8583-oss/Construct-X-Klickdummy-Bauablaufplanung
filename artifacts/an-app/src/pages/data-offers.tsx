/**
 * AN-App – Datenraum-Angebote (Task #112, enhanced in Task #118).
 *
 * Shows the list of data-space offers addressed to this AN.
 * Clicking an offer opens a detail panel with the policy acceptance flow.
 * After acceptance the AN can view the content snapshot — fachliche Ansicht
 * for TAKT_INFORMATION_PACKAGE; technical JSON shown collapsed.
 * Each offer with an associated TaktRequest shows a link to the detail page.
 */
import React, { useState } from 'react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import {
  useGetAnDataOffers,
  useGetAnDataOffer,
  useAcceptDataOffer,
  useRejectDataOffer,
  useGetDataOfferContent,
  useGetDataPublicationOdrl,
  useGetAnInboxMessages,
  type DataOfferSummary,
} from '@workspace/api-client-react';

// Local types for fields added by the AN Datenraum enhancement (not yet in generated types)
interface DataOfferProjectInfo {
  name: string;
  status: string;
  startDate?: string | null;
  endDate?: string | null;
  location?: string | null;
  description?: string | null;
}

interface DataOfferAssignment {
  id: string;
  workPackageReference?: string | null;
  trade?: string | null;
  assignmentStatus: string;
  validFrom?: string | null;
  validTo?: string | null;
}
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useLocation } from 'wouter';
import {
  Globe,
  Shield,
  CheckCircle2,
  XCircle,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Lock,
  Eye,
  FileJson,
  Building2,
  Calendar,
  MapPin,
  Wrench,
  ArrowRight,
  Bell,
  AlertTriangle,
  Info,
  FolderOpen,
} from 'lucide-react';

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  try { return format(new Date(d), 'dd.MM.yyyy HH:mm', { locale: de }); } catch { return d; }
}

function fmtDateOnly(d: string | null | undefined) {
  if (!d) return '—';
  try { return format(new Date(d), 'dd.MM.yyyy', { locale: de }); } catch { return d; }
}

// ── Status helpers ─────────────────────────────────────────────────────────────

const RECIPIENT_STATUS_BADGE: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  OFFERED:  { label: 'Neu',        variant: 'default' },
  ACCEPTED: { label: 'Akzeptiert', variant: 'secondary' },
  REJECTED: { label: 'Abgelehnt',  variant: 'destructive' },
  REVOKED:  { label: 'Widerrufen', variant: 'outline' },
  EXPIRED:  { label: 'Abgelaufen', variant: 'outline' },
};

const PUB_STATUS_BADGE: Record<string, string> = {
  PUBLISHED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  SUSPENDED: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  WITHDRAWN: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  DRAFT:     'bg-muted text-muted-foreground',
  EXPIRED:   'bg-muted text-muted-foreground',
};

const PRODUCT_LABEL: Record<string, string> = {
  PROJECT_OVERVIEW:             'Projektübersicht',
  PROJECT_COORDINATION_PACKAGE: 'Koordinationspaket',
  TAKT_INFORMATION_PACKAGE:     'Taktinformationspaket',
};

const PROJECT_STATUS_LABEL: Record<string, string> = {
  ACTIVE:    'Aktiv',
  COMPLETED: 'Abgeschlossen',
  ARCHIVED:  'Archiviert',
};

// ── Project Info Section ───────────────────────────────────────────────────────

function ProjectInfoSection({ info }: { info: DataOfferProjectInfo }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3.5 space-y-2.5">
      <div className="flex items-center gap-2">
        <FolderOpen className="h-4 w-4 text-primary shrink-0" />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Projektinformationen
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div className="sm:col-span-2">
          <div className="text-xs text-muted-foreground mb-0.5">Projektname</div>
          <div className="font-medium">{info.name}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-0.5">Status</div>
          <div className="font-medium">{PROJECT_STATUS_LABEL[info.status] ?? info.status}</div>
        </div>
        {(info.startDate || info.endDate) && (
          <div className="flex items-start gap-1.5">
            <Calendar className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">Zeitraum</div>
              <div className="font-medium">
                {fmtDateOnly(info.startDate)} – {fmtDateOnly(info.endDate)}
              </div>
            </div>
          </div>
        )}
        {info.location && (
          <div className="flex items-start gap-1.5 sm:col-span-2">
            <MapPin className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">Standort</div>
              <div className="font-medium">{info.location}</div>
            </div>
          </div>
        )}
        {info.description && (
          <div className="sm:col-span-2">
            <div className="text-xs text-muted-foreground mb-0.5">Beschreibung</div>
            <div className="text-sm text-foreground/80">{info.description}</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Package Assignments Section ────────────────────────────────────────────────

const ASSIGNMENT_STATUS_LABEL: Record<string, string> = {
  PLANNED:   'Geplant',
  ACTIVE:    'Aktiv',
  INACTIVE:  'Inaktiv',
  COMPLETED: 'Abgeschlossen',
  CANCELLED: 'Storniert',
};

function PackageAssignmentsSection({ assignments }: { assignments: DataOfferAssignment[] }) {
  if (assignments.length === 0) return null;
  return (
    <div className="rounded-lg border bg-muted/20 p-3.5 space-y-2.5">
      <div className="flex items-center gap-2">
        <Wrench className="h-4 w-4 text-primary shrink-0" />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Ihre Leistungszuordnung
        </span>
      </div>
      <div className="space-y-2">
        {assignments.map((a) => (
          <div key={a.id} className="rounded-md border bg-background px-3 py-2 text-sm space-y-1">
            {a.workPackageReference && (
              <div>
                <span className="text-xs text-muted-foreground">Arbeitspaket: </span>
                <span className="font-medium">{a.workPackageReference}</span>
              </div>
            )}
            {a.trade && (
              <div>
                <span className="text-xs text-muted-foreground">Gewerk: </span>
                <span className="font-medium">{a.trade}</span>
              </div>
            )}
            <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
              <span>
                Status:{' '}
                <span className="font-medium text-foreground">
                  {ASSIGNMENT_STATUS_LABEL[a.assignmentStatus] ?? a.assignmentStatus}
                </span>
              </span>
              {(a.validFrom || a.validTo) && (
                <span>
                  Gültig: {fmtDateOnly(a.validFrom)} – {fmtDateOnly(a.validTo)}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Access Notice ──────────────────────────────────────────────────────────────

function AccessNotice({ recipientStatus }: { recipientStatus: string }) {
  if (recipientStatus === 'ACCEPTED') return null;
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800/40 dark:bg-blue-950/20 px-3.5 py-3 flex gap-2.5">
      <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
      <div className="text-xs text-blue-700 dark:text-blue-300 space-y-0.5">
        <div className="font-semibold">Leistungsdetails erst nach Akzeptanz sichtbar</div>
        <div className="leading-relaxed text-blue-600/90 dark:text-blue-400/90">
          Die vollständigen Leistungsdetails (Takt-Daten, Zeitfenster, Ressourcenanforderungen)
          sind erst nach Akzeptanz der Nutzungsrichtlinie abrufbar. Leistungszuordnungen
          durch den Auftraggeber werden oben angezeigt, soweit sie bereits vergeben sind.
        </div>
      </div>
    </div>
  );
}

// ── Fachliche Takt-Content-View ────────────────────────────────────────────────

function TaktInformationPackageView({ payload }: { payload: Record<string, unknown> }) {
  const [showJson, setShowJson] = useState(false);
  const tw = payload.plannedTimeWindow as Record<string, unknown> | undefined;
  const loc = payload.location as Record<string, unknown> | undefined;
  const bw = payload.bufferTimeWindow as Record<string, unknown> | undefined;

  const workPackage  = (payload.workPackage ?? payload.taktBezeichnung) as string | undefined;
  const trade        = (payload.trade ?? payload.gewerk)                as string | undefined;
  const zone         = (loc?.zone ?? payload.zone)                      as string | undefined;
  const description  = (payload.requiredOutput ?? payload.description)  as string | undefined;
  const plannedStart = (tw?.start ?? payload.plannedStart)              as string | undefined;
  const plannedEnd   = (tw?.end   ?? payload.plannedEnd)                as string | undefined;
  const bufferStart  = bw?.earliestStart                                as string | undefined;
  const bufferEnd    = bw?.latestEnd                                    as string | undefined;
  const reqs = (payload.resourceRequirements as unknown[]) ?? [];

  return (
    <div className="space-y-4">
      {/* Fachliche Ansicht */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Taktdaten (fachliche Ansicht)
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {workPackage && (
            <div className="sm:col-span-2">
              <div className="text-xs text-muted-foreground mb-0.5">Arbeitspaket / Bezeichnung</div>
              <div className="font-medium">{workPackage}</div>
            </div>
          )}
          {trade && (
            <div className="flex items-start gap-2">
              <Wrench className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <div className="text-xs text-muted-foreground">Gewerk</div>
                <div className="font-medium">{trade}</div>
              </div>
            </div>
          )}
          {zone && (
            <div className="flex items-start gap-2">
              <MapPin className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <div className="text-xs text-muted-foreground">Zone</div>
                <div className="font-medium">{zone}</div>
              </div>
            </div>
          )}
          {(plannedStart || plannedEnd) && (
            <div className="sm:col-span-2 flex items-start gap-2">
              <Calendar className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <div className="text-xs text-muted-foreground">Geplanter Zeitraum</div>
                <div className="font-medium">
                  {fmtDateOnly(plannedStart)} – {fmtDateOnly(plannedEnd)}
                </div>
              </div>
            </div>
          )}
          {(bufferStart || bufferEnd) && (
            <div className="col-span-2">
              <div className="text-xs text-muted-foreground mb-0.5">Pufferzeitraum</div>
              <div className="text-sm">{fmtDateOnly(bufferStart)} – {fmtDateOnly(bufferEnd)}</div>
            </div>
          )}
          {description && (
            <div className="col-span-2">
              <div className="text-xs text-muted-foreground mb-0.5">Beschreibung / Leistung</div>
              <div className="text-sm text-foreground/80">{description}</div>
            </div>
          )}
        </div>

        {reqs.length > 0 && (
          <div>
            <div className="text-xs text-muted-foreground mb-1.5">Ressourcenanforderungen</div>
            <div className="space-y-1">
              {reqs.map((r: any, i: number) => (
                <div key={i} className="text-xs bg-muted/40 rounded px-2 py-1 flex items-center gap-3">
                  <span className="font-medium">{r.resourceType ?? '—'}</span>
                  {r.quantity && <span>× {r.quantity}</span>}
                  {r.notes && <span className="text-muted-foreground">{r.notes}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Collapsed JSON */}
      <div>
        <button
          type="button"
          onClick={() => setShowJson(v => !v)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <FileJson className="h-3.5 w-3.5" />
          Technisches JSON {showJson ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        {showJson && (
          <pre className="text-[11px] font-mono whitespace-pre-wrap break-all bg-muted/50 rounded p-2 max-h-48 overflow-y-auto mt-1.5">
            {JSON.stringify(payload, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

// ── Generic content view ───────────────────────────────────────────────────────

function GenericContentView({ content }: { content: Record<string, unknown> }) {
  return (
    <pre className="text-[11px] font-mono whitespace-pre-wrap break-all bg-muted/50 rounded p-2 max-h-64 overflow-y-auto">
      {JSON.stringify(content, null, 2)}
    </pre>
  );
}

// ── Detail Panel ───────────────────────────────────────────────────────────────

function OfferDetailPanel({
  offer: offerSummary,
  onClose,
}: {
  offer: DataOfferSummary;
  onClose: () => void;
}) {
  const { toast }    = useToast();
  const [, setLocation] = useLocation();
  const { data: offer, isLoading } = useGetAnDataOffer(offerSummary.publicationId);
  const accept = useAcceptDataOffer();
  const reject = useRejectDataOffer();
  const [showContent, setShowContent] = useState(false);
  const [odrlEnabled, setOdrlEnabled] = useState(false);
  const { data: content, isLoading: contentLoading } = useGetDataOfferContent(
    offerSummary.publicationId,
    showContent,
  );
  const { data: odrl, isLoading: odrlLoading } = useGetDataPublicationOdrl(
    offerSummary.publicationId,
    odrlEnabled,
  );

  const handleAccept = async () => {
    try {
      await accept.mutateAsync(offerSummary.publicationId);
      toast({ title: 'Nutzungsrichtlinie akzeptiert', description: 'Sie können jetzt auf den Inhalt zugreifen.' });
    } catch (err) {
      toast({ title: 'Fehler', description: (err as Error).message, variant: 'destructive' });
    }
  };

  const handleReject = async () => {
    if (!confirm('Möchten Sie dieses Angebot wirklich ablehnen?')) return;
    try {
      await reject.mutateAsync(offerSummary.publicationId);
      toast({ title: 'Angebot abgelehnt' });
    } catch (err) {
      toast({ title: 'Fehler', description: (err as Error).message, variant: 'destructive' });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3 py-4">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    );
  }

  if (!offer) return <div className="py-4 text-muted-foreground">Angebot nicht gefunden.</div>;

  const canAccept = offer.recipientStatus === 'OFFERED' && offer.publicationStatus === 'PUBLISHED';
  const canReject = ['OFFERED', 'ACCEPTED'].includes(offer.recipientStatus) && offer.publicationStatus === 'PUBLISHED';
  const canViewContent = offer.recipientStatus === 'ACCEPTED' && offer.publicationStatus === 'PUBLISHED';

  // Linked TaktRequest (if any)
  const linkedTaktRequestId = (offer as any).taktRequestId as string | undefined;

  return (
    <div className="space-y-5 py-2">
      {/* Header info */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PUB_STATUS_BADGE[offer.publicationStatus] ?? 'bg-muted text-muted-foreground'}`}>
            {offer.publicationStatus}
          </span>
          <Badge variant={RECIPIENT_STATUS_BADGE[offer.recipientStatus]?.variant ?? 'outline'}>
            {RECIPIENT_STATUS_BADGE[offer.recipientStatus]?.label ?? offer.recipientStatus}
          </Badge>
          <Badge variant="outline" className="text-[10px]">v{offer.version}</Badge>
        </div>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Building2 className="h-3.5 w-3.5 shrink-0" />
          {offer.agName}
        </div>
        <div className="text-xs text-muted-foreground">
          Produkt: {PRODUCT_LABEL[offer.dataProductType] ?? offer.dataProductType}
        </div>
        {offer.description && (
          <p className="text-sm text-muted-foreground">{offer.description}</p>
        )}
        {(offer.validFrom || offer.validUntil) && (
          <div className="text-xs text-muted-foreground">
            Gültig: {offer.validFrom ? fmtDate(offer.validFrom) : 'sofort'} – {offer.validUntil ? fmtDate(offer.validUntil) : 'unbegrenzt'}
          </div>
        )}
      </div>

      {/* Project info — visible before acceptance */}
      {(offer as any).projectInfo && (
        <ProjectInfoSection info={(offer as any).projectInfo as DataOfferProjectInfo} />
      )}

      {/* Package assignments — show this AN's allocated work packages */}
      {(offer as any).assignments && ((offer as any).assignments as DataOfferAssignment[]).length > 0 && (
        <PackageAssignmentsSection assignments={(offer as any).assignments as DataOfferAssignment[]} />
      )}

      {/* Access notice — shown when policy not yet accepted */}
      <AccessNotice recipientStatus={offer.recipientStatus} />

      {/* Linked TaktRequest */}
      {linkedTaktRequestId && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 flex items-center justify-between gap-2">
          <div>
            <div className="text-xs font-semibold text-primary">Zugehörige TaktAnfrage</div>
            <div className="text-xs text-muted-foreground">Zu dieser Veröffentlichung gehört eine offene Koordinationsanfrage.</div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              onClose();
              setLocation(`/takt-requests/${linkedTaktRequestId}`);
            }}
            className="gap-1 shrink-0"
          >
            Bearbeiten <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}

      {/* Policy — tabbed view */}
      {offer.policy && (
        <div className="rounded-lg border bg-muted/20">
          <div className="flex items-center gap-2 px-3.5 pt-3 pb-2 border-b border-border/60">
            <Shield className="h-4 w-4 text-primary shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground leading-tight">Vom GU vorgegebene Policy</p>
              <p className="font-semibold text-sm leading-tight">{offer.policy.name}</p>
            </div>
          </div>
          <Tabs defaultValue="inhalt" className="px-3.5 pb-3.5 pt-2">
            <TabsList className="grid w-full grid-cols-2 h-8">
              <TabsTrigger value="inhalt" className="text-xs">Inhalt</TabsTrigger>
              <TabsTrigger
                value="odrl"
                className="text-xs"
                onClick={() => setOdrlEnabled(true)}
              >
                ODRL / JSON-LD
              </TabsTrigger>
            </TabsList>
            <TabsContent value="inhalt" className="mt-3 max-h-[300px] overflow-y-auto pr-1">
              <div className="space-y-3 text-xs">
                {offer.policy.purpose && (
                  <div>
                    <div className="font-semibold uppercase tracking-wider text-muted-foreground mb-1">Zweck</div>
                    <p className="text-foreground/80">{offer.policy.purpose}</p>
                  </div>
                )}
                {(offer.policy.permissions as string[]).length > 0 && (
                  <div>
                    <div className="font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-1">Erlaubt</div>
                    <ul className="space-y-0.5">
                      {(offer.policy.permissions as string[]).map((p, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className="mt-1.5 w-1 h-1 rounded-full bg-emerald-500 shrink-0" />
                          <span>{p}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {(offer.policy.prohibitions as string[]).length > 0 && (
                  <div>
                    <div className="font-semibold uppercase tracking-wider text-red-600 dark:text-red-400 mb-1">Nicht erlaubt</div>
                    <ul className="space-y-0.5">
                      {(offer.policy.prohibitions as string[]).map((p, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className="mt-1.5 w-1 h-1 rounded-full bg-red-500 shrink-0" />
                          <span>{p}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {offer.policy.validityRule && (
                  <div>
                    <div className="font-semibold uppercase tracking-wider text-muted-foreground mb-1">Bedingungen</div>
                    <p className="text-foreground/80">{offer.policy.validityRule}</p>
                  </div>
                )}
                {offer.policy.retentionRule && (
                  <div>
                    <div className="font-semibold uppercase tracking-wider text-muted-foreground mb-1">Aufbewahrung</div>
                    <p className="text-foreground/80">{offer.policy.retentionRule}</p>
                  </div>
                )}
                {(offer.policy as any).description && (
                  <div className="rounded bg-muted/50 px-2.5 py-2 text-muted-foreground italic">
                    {(offer.policy as any).description}
                  </div>
                )}
              </div>
            </TabsContent>
            <TabsContent value="odrl" className="mt-3">
              {odrlLoading && (
                <p className="text-xs text-muted-foreground py-2">ODRL wird geladen…</p>
              )}
              {!odrlLoading && odrl && (
                <pre className="text-[11px] font-mono whitespace-pre-wrap break-all bg-muted/50 rounded p-2.5 max-h-[260px] overflow-y-auto">
                  {JSON.stringify(odrl, null, 2)}
                </pre>
              )}
              {!odrlLoading && !odrl && odrlEnabled && (
                <p className="text-xs text-muted-foreground py-2">ODRL konnte nicht geladen werden.</p>
              )}
            </TabsContent>
          </Tabs>
        </div>
      )}

      {/* Accept / reject buttons */}
      {(canAccept || canReject) && (
        <div className="flex gap-2">
          {canAccept && (
            <Button size="sm" onClick={handleAccept} disabled={accept.isPending} className="flex-1">
              <CheckCircle2 className="h-4 w-4 mr-1.5" />
              {accept.isPending ? 'Wird akzeptiert…' : 'Richtlinie akzeptieren'}
            </Button>
          )}
          {canReject && (
            <Button size="sm" variant="outline" onClick={handleReject} disabled={reject.isPending}>
              <XCircle className="h-4 w-4 mr-1.5" />
              Ablehnen
            </Button>
          )}
        </div>
      )}

      {offer.recipientStatus === 'ACCEPTED' && (
        <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Akzeptiert am {fmtDate(offer.policyAcceptedAt)}
        </div>
      )}

      {/* Content access */}
      {canViewContent && (
        <div className="border-t pt-4 space-y-3">
          {!showContent && (
            <Button
              size="sm"
              variant="outline"
              className="w-full gap-1.5"
              onClick={() => setShowContent(true)}
              disabled={contentLoading}
            >
              <Eye className="h-4 w-4" />
              {contentLoading ? 'Lade Inhalt…' : 'Inhalt anzeigen'}
            </Button>
          )}

          {content && (
            <div className="rounded-lg border bg-card p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <FileJson className="h-3.5 w-3.5" />
                  Inhalt (Snapshot v{content.version})
                </div>
                {content.contentHash && (
                  <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[120px]">
                    SHA256: {content.contentHash.slice(0, 12)}…
                  </span>
                )}
              </div>

              {/* Fachliche or generic view */}
              {offer.dataProductType === 'TAKT_INFORMATION_PACKAGE' && content.content ? (
                <TaktInformationPackageView payload={content.content as Record<string, unknown>} />
              ) : (
                <GenericContentView content={content.content as Record<string, unknown>} />
              )}

              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Lock className="h-3 w-3" />
                Nur Felder, denen Sie zugestimmt haben. Interne Daten des AG sind nicht enthalten.
              </div>
            </div>
          )}
        </div>
      )}

      {offer.recipientStatus === 'REJECTED' && (
        <div className="flex items-center gap-1.5 text-xs text-destructive">
          <XCircle className="h-3.5 w-3.5" />
          Abgelehnt am {fmtDate(offer.policyRejectedAt)}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const REMINDER_LABELS: Record<string, string> = {
  RESPONSE_DUE_SOON: 'Antwort bald fällig',
  RESPONSE_DUE_TODAY: 'Antwort heute fällig',
  RESPONSE_OVERDUE: 'Antwort überfällig',
  GU_DECISION_DUE_SOON: 'AG-Entscheidung bald fällig',
  GU_DECISION_OVERDUE: 'AG-Entscheidung überfällig',
};

export default function DataOffersPage() {
  const { data: offers, isLoading } = useGetAnDataOffers();
  const { data: reminders } = useGetAnInboxMessages();
  const [openId, setOpenId] = useState<string | null>(null);
  const toggleOffer = (id: string) => setOpenId((prev) => (prev === id ? null : id));

  const grouped = {
    new: offers?.filter((o) => o.recipientStatus === 'OFFERED' && o.publicationStatus === 'PUBLISHED') ?? [],
    accepted: offers?.filter((o) => o.recipientStatus === 'ACCEPTED') ?? [],
    other: offers?.filter(
      (o) => !['OFFERED'].includes(o.recipientStatus) || o.publicationStatus !== 'PUBLISHED',
    ).filter((o) => o.recipientStatus !== 'ACCEPTED') ?? [],
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex items-center gap-3">
        <Globe className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Datenraum</h1>
          <p className="text-sm text-muted-foreground">
            Von Auftraggebern bereitgestellte Projektdaten und Angebote
          </p>
        </div>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}

      {!isLoading && offers?.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Globe className="h-12 w-12 text-muted-foreground/30 mb-4" />
          <h3 className="font-medium text-lg text-muted-foreground">Keine Angebote vorhanden</h3>
          <p className="text-sm text-muted-foreground/70 mt-1 max-w-sm">
            Sobald ein Auftraggeber Projektdaten für Ihr Unternehmen bereitstellt, erscheinen sie hier.
          </p>
        </div>
      )}

      {/* Datenraum-Erinnerungen (TAKT_REQUEST_REMINDER / TAKT_REQUEST_EXPIRED) */}
      {reminders && reminders.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2">
            <Bell className="h-3.5 w-3.5 text-orange-500" />
            Erinnerungen ({reminders.length})
          </h2>
          <div className="space-y-2">
            {reminders.map((msg) => {
              const p = msg.payload;
              const isExpired = msg.messageType === 'TAKT_REQUEST_EXPIRED';
              return (
                <div
                  key={msg.id}
                  className={`flex items-start gap-3 p-3 rounded-lg border ${
                    isExpired
                      ? 'border-destructive/30 bg-destructive/5'
                      : 'border-orange-500/30 bg-orange-500/5'
                  }`}
                >
                  <div className={`mt-0.5 shrink-0 ${isExpired ? 'text-destructive' : 'text-orange-500'}`}>
                    {isExpired ? (
                      <AlertTriangle className="h-4 w-4" />
                    ) : (
                      <Bell className="h-4 w-4" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${
                          isExpired
                            ? 'bg-destructive/10 text-destructive'
                            : 'bg-orange-500/10 text-orange-600'
                        }`}
                      >
                        {isExpired
                          ? 'Abgelaufen'
                          : (p.reminderType
                              ? (REMINDER_LABELS[p.reminderType] ?? p.reminderType)
                              : 'Erinnerung')}
                      </span>
                      {p.requestNumber && (
                        <span className="text-xs font-mono text-muted-foreground">{p.requestNumber}</span>
                      )}
                    </div>
                    {p.taktReference && (
                      <div className="text-sm font-medium mt-1 truncate">
                        {[p.taktReference.taktBezeichnung, p.taktReference.zone, p.taktReference.gewerk]
                          .filter(Boolean).join(' · ')}
                      </div>
                    )}
                    {p.dueAt && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Frist: {format(new Date(p.dueAt), 'dd.MM.yyyy HH:mm', { locale: de })}
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Erhalten: {format(new Date(msg.receivedAt), 'dd.MM.yyyy HH:mm', { locale: de })}
                    </div>
                  </div>
                  {p.taktRequestId && (
                    <a href={`/an/takt-requests/${p.taktRequestId}`}>
                      <button
                        className="h-7 w-7 flex items-center justify-center rounded hover:bg-muted/50 shrink-0"
                        title="Zur Anfrage"
                      >
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {grouped.new.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-primary" />
            Neue Angebote ({grouped.new.length})
          </h2>
          <div className="space-y-2">
            {grouped.new.map((o) => (
              <OfferAccordionItem key={o.publicationId} offer={o} openId={openId} onToggle={toggleOffer} />
            ))}
          </div>
        </section>
      )}

      {grouped.accepted.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Akzeptiert ({grouped.accepted.length})
          </h2>
          <div className="space-y-2">
            {grouped.accepted.map((o) => (
              <OfferAccordionItem key={o.publicationId} offer={o} openId={openId} onToggle={toggleOffer} />
            ))}
          </div>
        </section>
      )}

      {grouped.other.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Weitere ({grouped.other.length})
          </h2>
          <div className="space-y-2">
            {grouped.other.map((o) => (
              <OfferAccordionItem key={o.publicationId} offer={o} openId={openId} onToggle={toggleOffer} />
            ))}
          </div>
        </section>
      )}

    </div>
  );
}

// ── Accordion row component ───────────────────────────────────────────────────

function OfferAccordionItem({
  offer,
  openId,
  onToggle,
}: {
  offer: DataOfferSummary;
  openId: string | null;
  onToggle: (id: string) => void;
}) {
  const isOpen    = openId === offer.publicationId;
  const statusInfo = RECIPIENT_STATUS_BADGE[offer.recipientStatus];

  return (
    <div className={`rounded-lg border transition-colors ${isOpen ? 'border-primary/40' : 'border-border'}`}>
      {/* Header row — click to expand/collapse */}
      <button
        type="button"
        onClick={() => onToggle(offer.publicationId)}
        className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors rounded-lg"
      >
        <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{offer.title}</div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-[11px] text-muted-foreground">{offer.agName}</span>
            <span className="text-[11px] text-muted-foreground">·</span>
            <span className="text-[11px] text-muted-foreground">
              {PRODUCT_LABEL[offer.dataProductType] ?? offer.dataProductType}
            </span>
            {offer.validUntil && (
              <>
                <span className="text-[11px] text-muted-foreground">·</span>
                <span className="text-[11px] text-muted-foreground">
                  bis {fmtDateOnly(offer.validUntil)}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {statusInfo && (
            <Badge variant={statusInfo.variant} className="text-[10px]">
              {statusInfo.label}
            </Badge>
          )}
          {isOpen
            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
            : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>

      {/* Inline detail panel — expands below the header */}
      {isOpen && (
        <div className="border-t border-border/60 px-4 pt-4 pb-5">
          <OfferDetailPanel
            offer={offer}
            onClose={() => onToggle(offer.publicationId)}
          />
        </div>
      )}
    </div>
  );
}
