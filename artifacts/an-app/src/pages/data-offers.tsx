/**
 * AN-App – Leistungsfreigaben im Datenraum.
 *
 * Shows Leistungsfreigaben addressed to this AN.
 * After acceptance the AN can view the immutable content snapshot.
 */
import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import {
  useGetAnDataOffers,
  useGetAnDataOffer,
  useAcceptDataOffer,
  useRejectDataOffer,
  useGetAnInboxMessages,
  type DataOfferSummary,
  type DataOfferProjectInfo,
  type DataOfferAssignment,
} from '@workspace/api-client-react';

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

const PUB_STATUS_LABEL: Record<string, string> = {
  PUBLISHED: 'Veröffentlicht',
  SUSPENDED: 'Pausiert',
  WITHDRAWN: 'Zurückgezogen',
  DRAFT: 'Entwurf',
  EXPIRED: 'Abgelaufen',
};

const PRODUCT_LABEL: Record<string, string> = {
  PROJECT_OVERVIEW:             'Projektübersicht',
  PROJECT_COORDINATION_PACKAGE: 'Koordinationspaket',
  PROJECT_MEMBERSHIP:          'Projektaufnahme',
  TAKT_INFORMATION_PACKAGE:     'Leistungsinformationspaket',
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
          Die vollständigen Leistungsdetails (Leistungsdaten, Zeitfenster, Ressourcenanforderungen)
          sind erst nach Akzeptanz der Nutzungsrichtlinie abrufbar. Leistungszuordnungen
          durch den Auftraggeber werden oben angezeigt, soweit sie bereits vergeben sind.
        </div>
      </div>
    </div>
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

  const handleAccept = async () => {
    try {
      await accept.mutateAsync(offerSummary.publicationId);
      toast({ title: 'Leistungsfreigabe akzeptiert', description: 'Sie können jetzt auf die freigegebenen Leistungen zugreifen.' });
    } catch (err) {
      toast({ title: 'Fehler', description: (err as Error).message, variant: 'destructive' });
    }
  };

  const handleReject = async () => {
    if (!confirm('Möchten Sie diese Leistungsfreigabe wirklich ablehnen?')) return;
    try {
      await reject.mutateAsync(offerSummary.publicationId);
      toast({ title: 'Leistungsfreigabe abgelehnt' });
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

  if (!offer) return <div className="py-4 text-muted-foreground">Leistungsfreigabe nicht gefunden.</div>;

  const canAccept = offer.recipientStatus === 'OFFERED' && offer.publicationStatus === 'PUBLISHED';
  const canReject = offer.recipientStatus === 'OFFERED' && offer.publicationStatus === 'PUBLISHED';

  // Linked service request (if any)
  const linkedTaktRequestId = (offer as any).taktRequestId as string | undefined;

  return (
    <div className="space-y-5 py-2">
      {/* Header info */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PUB_STATUS_BADGE[offer.publicationStatus] ?? 'bg-muted text-muted-foreground'}`}>
            {PUB_STATUS_LABEL[offer.publicationStatus] ?? offer.publicationStatus}
          </span>
          <Badge variant={RECIPIENT_STATUS_BADGE[offer.recipientStatus]?.variant ?? 'outline'}>
            {RECIPIENT_STATUS_BADGE[offer.recipientStatus]?.label ?? offer.recipientStatus}
          </Badge>
          <Badge variant="outline" className="text-[10px]">v{offer.version}</Badge>
        </div>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Building2 className="h-3.5 w-3.5 shrink-0" />
          {offer.agName ?? "Auftraggebername nicht veröffentlicht"}
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
      {offer.projectInfo && (
        <ProjectInfoSection info={offer.projectInfo} />
      )}

       {/* Package assignments are protected until the policy is accepted. */}
       {offer.recipientStatus === 'ACCEPTED' && offer.assignments.length > 0 && (
        <PackageAssignmentsSection assignments={offer.assignments} />
      )}

       {/* Invitation and data offer are deliberately separate processes. */}
       {offer.projectName && (
         <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-foreground/80">
           Diese Leistungsfreigabe gehört zum Projekt <strong>{offer.projectName}</strong>.
            Die Projektmitgliedschaft und die Leistungsfreigabe sind getrennte Schritte.
         </div>
       )}
       <AccessNotice recipientStatus={offer.recipientStatus} />

      {/* Linked service request */}
      {linkedTaktRequestId && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 flex items-center justify-between gap-2">
          <div>
            <div className="text-xs font-semibold text-primary">Zugehörige Leistungsanfrage</div>
            <div className="text-xs text-muted-foreground">Zu dieser Veröffentlichung gehört eine offene Koordinationsanfrage.</div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              onClose();
              setLocation(`/leistungsanfragen/${linkedTaktRequestId}`);
            }}
            className="gap-1 shrink-0"
          >
            Bearbeiten <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}

      {/* Policy conditions */}
      {offer.policy && (
        <div className="rounded-lg border bg-muted/20">
          <div className="flex items-center gap-2 px-3.5 pt-3 pb-2 border-b border-border/60">
            <Shield className="h-4 w-4 text-primary shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground leading-tight">Vom GU vorgegebene Policy</p>
              <p className="font-semibold text-sm leading-tight">{offer.policy.name}</p>
            </div>
          </div>
          <div className="px-3.5 pb-3.5 pt-3 max-h-[300px] overflow-y-auto">
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

      {offer.recipientStatus === 'ACCEPTED' && offer.publicationStatus === 'PUBLISHED' && (
        <div className="border-t pt-4">
          <Button
            size="sm"
            className="w-full gap-1.5"
            onClick={() => {
              onClose();
              setLocation('/leistungen');
            }}
          >
            Leistungen öffnen <ArrowRight className="h-4 w-4" />
          </Button>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Die freigegebenen Leistungen werden in der Arbeitsansicht angezeigt.
          </p>
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
  const [location] = useLocation();
  const { data: offers, isLoading } = useGetAnDataOffers();
  const { data: reminders } = useGetAnInboxMessages();
  const publicationIdFromUrl = new URLSearchParams(location.split("?")[1] ?? "").get("publicationId");
  const [openId, setOpenId] = useState<string | null>(publicationIdFromUrl);
  const toggleOffer = (id: string) => setOpenId((prev) => (prev === id ? null : id));

  useEffect(() => {
    if (publicationIdFromUrl && offers?.some((offer) => offer.publicationId === publicationIdFromUrl)) {
      setOpenId(publicationIdFromUrl);
    }
  }, [offers, publicationIdFromUrl]);

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
          <h1 className="text-2xl font-bold tracking-tight">Leistungsfreigaben</h1>
          <p className="text-sm text-muted-foreground">
            Vom Auftraggeber veröffentlichte Leistungen und Nutzungsbedingungen
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
          <h3 className="font-medium text-lg text-muted-foreground">Keine Leistungsfreigaben vorhanden</h3>
          <p className="text-sm text-muted-foreground/70 mt-1 max-w-sm">
            Sobald ein Auftraggeber Leistungen für Ihr Unternehmen freigibt, erscheinen sie hier.
          </p>
        </div>
      )}

      {/* Datenraum-Erinnerungen */}
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
                    <a href={`/an/leistungsanfragen/${p.taktRequestId}`}>
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
             Neue Leistungsfreigaben ({grouped.new.length})
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
             Weitere Leistungsfreigaben ({grouped.other.length})
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
            <span className="text-[11px] text-muted-foreground">{offer.agName ?? "Auftraggebername nicht veröffentlicht"}</span>
            <span className="text-[11px] text-muted-foreground">·</span>
            <span className="text-[11px] font-medium text-foreground">{offer.projectName ?? "Projektname nicht veröffentlicht"}</span>
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
