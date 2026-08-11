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
  type DataOfferSummary,
} from '@workspace/api-client-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
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
  const { data: content, isLoading: contentLoading } = useGetDataOfferContent(
    offerSummary.publicationId,
    showContent,
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

      {/* Policy */}
      {offer.policy && (
        <div className="rounded-lg border p-3.5 space-y-2 bg-muted/30">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">{offer.policy.name}</span>
          </div>
          <p className="text-xs text-muted-foreground">{offer.policy.purpose}</p>
          <div className="text-xs space-y-0.5">
            <div>
              <span className="font-medium">Erlaubt: </span>
              {(offer.policy.permissions as string[]).join(', ')}
            </div>
            <div>
              <span className="font-medium">Verboten: </span>
              {(offer.policy.prohibitions as string[]).join(', ')}
            </div>
            <div>
              <span className="font-medium">Gültigkeit: </span>
              {offer.policy.validityRule}
            </div>
            {offer.policy.retentionRule && (
              <div>
                <span className="font-medium">Aufbewahrung: </span>
                {offer.policy.retentionRule}
              </div>
            )}
          </div>
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

export default function DataOffersPage() {
  const { data: offers, isLoading } = useGetAnDataOffers();
  const [selected, setSelected] = useState<DataOfferSummary | null>(null);

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

      {grouped.new.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-primary" />
            Neue Angebote ({grouped.new.length})
          </h2>
          <div className="space-y-2">
            {grouped.new.map((o) => (
              <OfferRow key={o.publicationId} offer={o} onClick={() => setSelected(o)} />
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
              <OfferRow key={o.publicationId} offer={o} onClick={() => setSelected(o)} />
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
              <OfferRow key={o.publicationId} offer={o} onClick={() => setSelected(o)} />
            ))}
          </div>
        </section>
      )}

      {/* Detail sheet */}
      <Sheet open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          {selected && (
            <>
              <SheetHeader className="mb-4">
                <SheetTitle className="text-base leading-tight">{selected.title}</SheetTitle>
                <SheetDescription>
                  {PRODUCT_LABEL[selected.dataProductType] ?? selected.dataProductType}
                </SheetDescription>
              </SheetHeader>
              <OfferDetailPanel
                offer={selected}
                onClose={() => setSelected(null)}
              />
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ── Row component ─────────────────────────────────────────────────────────────

function OfferRow({ offer, onClick }: { offer: DataOfferSummary; onClick: () => void }) {
  const statusInfo = RECIPIENT_STATUS_BADGE[offer.recipientStatus];
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-lg border border-border hover:border-primary/40 hover:bg-muted/30 transition-colors"
    >
      <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{offer.title}</div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-[11px] text-muted-foreground">{offer.agName}</span>
          <span className="text-[11px] text-muted-foreground">·</span>
          <span className="text-[11px] text-muted-foreground">{PRODUCT_LABEL[offer.dataProductType] ?? offer.dataProductType}</span>
          {offer.validUntil && (
            <>
              <span className="text-[11px] text-muted-foreground">·</span>
              <span className="text-[11px] text-muted-foreground">bis {fmtDate(offer.validUntil)}</span>
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
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </div>
    </button>
  );
}
