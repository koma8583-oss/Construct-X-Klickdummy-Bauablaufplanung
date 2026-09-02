import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Database,
  LockKeyhole,
  UserPlus,
  XCircle,
} from "lucide-react";
import type {
  DataPublication,
  ProjectMembership,
  PublicationRecipientSummary,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ProcessMembership = Pick<ProjectMembership, "id" | "anOrgId" | "status">;

interface Props {
  memberships: ProcessMembership[];
  publications: DataPublication[];
  getPartnerName: (anOrgId: string) => string;
  onInvite: () => void;
  onReleaseData: (anOrgId: string, draftPublicationId?: string) => void;
}

type StepState = "complete" | "current" | "locked" | "rejected";

const STATE_STYLES: Record<StepState, string> = {
  complete: "border-emerald-500/30 bg-emerald-500/5",
  current: "border-primary/30 bg-primary/5",
  locked: "border-border bg-muted/20 opacity-75",
  rejected: "border-destructive/30 bg-destructive/5",
};

type EffectivePublicationState = {
  publishedPublication?: DataPublication;
  publishedRecipient?: PublicationRecipientSummary;
  draftPublication?: DataPublication;
};

function publicationTimestamp(publication: DataPublication): number {
  return Date.parse(publication.publishedAt ?? publication.createdAt) || 0;
}

function newestPublication(publications: DataPublication[]): DataPublication | undefined {
  return [...publications].sort((a, b) => {
    const timestampDifference = publicationTimestamp(b) - publicationTimestamp(a);
    return timestampDifference !== 0 ? timestampDifference : b.id.localeCompare(a.id);
  })[0];
}

/**
 * A draft is not allowed to hide an already published offer. The published
 * version is the effective access state; a draft is only an additional hint
 * that a newer release is being prepared.
 */
export function getEffectivePublicationState(
  publications: DataPublication[],
  anOrgId: string,
): EffectivePublicationState {
  const partnerPublications = publications.filter((publication) =>
    publication.recipients?.some((recipient) => recipient.anOrgId === anOrgId),
  );
  const publishedPublication = newestPublication(
    partnerPublications.filter((publication) => publication.status === "PUBLISHED"),
  );
  const draftPublication = newestPublication(
    partnerPublications.filter((publication) => publication.status === "DRAFT"),
  );

  return {
    publishedPublication,
    publishedRecipient: publishedPublication?.recipients?.find(
      (recipient) => recipient.anOrgId === anOrgId,
    ),
    draftPublication,
  };
}

function StepIcon({ state }: { state: StepState }) {
  if (state === "complete") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (state === "rejected") return <XCircle className="h-4 w-4 text-destructive" />;
  if (state === "locked") return <LockKeyhole className="h-4 w-4 text-muted-foreground" />;
  return <Clock3 className="h-4 w-4 text-primary" />;
}

function ProcessStep({
  number,
  label,
  detail,
  state,
  action,
  onAction,
}: {
  number: number;
  label: string;
  detail: string;
  state: StepState;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div
      data-testid={`collaboration-process-step-${number}`}
      className={`min-w-0 rounded-lg border p-3 ${STATE_STYLES[state]}`}
    >
      <div className="flex items-start gap-2.5">
        <div
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
            state === "complete"
              ? "bg-emerald-600 text-white"
              : state === "rejected"
                ? "bg-destructive text-destructive-foreground"
                : state === "current"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
          }`}
        >
          {number}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <StepIcon state={state} />
            <p className="text-sm font-semibold">{label}</p>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p>
          {action && onAction && (
            <Button
              data-testid={`collaboration-process-action-${number}`}
              size="sm"
              className="mt-3 h-8 text-xs"
              onClick={onAction}
            >
              {action}
              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function PartnerProcess({
  membership,
  publications,
  partnerName,
  onReleaseData,
}: {
  membership: ProcessMembership;
  publications: DataPublication[];
  partnerName: string;
  onReleaseData: (anOrgId: string, draftPublicationId?: string) => void;
}) {
  const isActive = membership.status === "ACTIVE";
  const isRejected = membership.status === "REJECTED";
  const isRevoked = membership.status === "REVOKED";
  const invitationSent = isActive || isRejected || isRevoked || membership.status === "INVITED";
  const {
    publishedPublication,
    publishedRecipient,
    draftPublication,
  } = getEffectivePublicationState(publications, membership.anOrgId);
  const isPublished = !!publishedPublication;
  const recipientStatus = publishedRecipient?.status;
  const releasedTaktCount = publishedPublication?.selectedTaktIds?.length ?? 0;
  const draftTaktCount = draftPublication?.selectedTaktIds?.length ?? 0;

  const publicationDetail = !isActive
    ? "Gesperrt · erst nach aktiver Projektmitgliedschaft"
    : isPublished
      ? draftPublication
        ? "Leistungsfreigabe veröffentlicht · neuer Entwurf vorhanden"
        : "Leistungsfreigabe veröffentlicht"
      : draftPublication
        ? "Leistungsfreigabe als Entwurf gespeichert · erneut veröffentlichbar"
        : "Noch keine Leistungsfreigabe veröffentlicht";

  const accessDetail = !isActive
    ? "Gesperrt · erst nach Leistungsfreigabe"
    : !isPublished
      ? "Gesperrt · erst nach veröffentlichter Leistungsfreigabe"
      : recipientStatus === "OFFERED"
        ? "Freigabe wartet auf Prüfung/Akzeptanz durch AN"
        : recipientStatus === "ACCEPTED"
          ? "AN-Zugriff aktiv · abgeschlossen"
          : recipientStatus === "REJECTED"
            ? "Freigabe abgelehnt"
            : recipientStatus === "REVOKED"
              ? "AN-Zugriff widerrufen"
              : recipientStatus === "EXPIRED"
                ? "Leistungsfreigabe abgelaufen"
                : "Empfängerstatus nicht verfügbar";

  const accessState: StepState = !isActive || !isPublished
    ? "locked"
    : recipientStatus === "ACCEPTED"
      ? "complete"
      : recipientStatus === "REJECTED" ||
          recipientStatus === "REVOKED" ||
          recipientStatus === "EXPIRED"
        ? "rejected"
        : "current";

  return (
    <div
      data-testid={`collaboration-process-partner-${membership.anOrgId}`}
      className="rounded-xl border border-border bg-background/70 p-4"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{partnerName} · Leistungsfreigabe</p>
          <p className="text-xs text-muted-foreground">
            {isActive
              ? "Aktive Projektmitgliedschaft"
              : membership.status === "INVITED"
                ? "Einladung gesendet"
                : membership.status === "REVOKED"
                  ? "Projektmitgliedschaft widerrufen"
                  : "Projektaufnahme abgelehnt"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {isPublished
              ? `${releasedTaktCount} ${releasedTaktCount === 1 ? "Leistung" : "Leistungen"} freigegeben · AN-Status: ${
                  recipientStatus === "ACCEPTED"
                    ? "angenommen"
                    : recipientStatus === "OFFERED"
                      ? "wartet auf Annahme"
                      : recipientStatus?.toLowerCase() ?? "nicht zugestellt"
                }`
              : draftPublication
                ? `${draftTaktCount} ${draftTaktCount === 1 ? "Leistung" : "Leistungen"} im Entwurf`
                : "Noch keine Leistung freigegeben"}
          </p>
        </div>
        <Badge
          variant={isActive ? "default" : isRejected || isRevoked ? "destructive" : "outline"}
          className="shrink-0"
        >
          {isActive
            ? "Mitgliedschaft aktiv"
            : isRejected
              ? "Abgelehnt"
              : isRevoked
                ? "Widerrufen"
                : "Einladung offen"}
        </Badge>
      </div>

      <div className="grid gap-2 md:grid-cols-4">
        <ProcessStep
          number={1}
          label="Einladung"
          detail={
            !invitationSent
              ? "Noch nicht gesendet"
              : isRejected
              ? "Einladung abgelehnt"
                : isRevoked
                  ? "Einladung gesendet"
                  : "Gesendet"
          }
          state={isRejected || isRevoked || invitationSent ? "complete" : "current"}
        />
        <ProcessStep
          number={2}
          label="Projektmitgliedschaft"
          detail={
            isRejected
              ? "Projektaufnahme abgelehnt"
              : isRevoked
                ? "Projektmitgliedschaft widerrufen"
              : isActive
                ? "Aktiv"
                : "Warten auf Annahme durch AN"
          }
          state={isRejected || isRevoked ? "rejected" : isActive ? "complete" : "current"}
        />
        <ProcessStep
          number={3}
          label="Leistungsfreigabe"
          detail={publicationDetail}
          state={isRejected || isRevoked ? "locked" : isPublished ? "complete" : isActive ? "current" : "locked"}
          action={isActive && !isPublished ? (draftPublication ? "Entwurf veröffentlichen" : "Leistungen für AN freigeben") : undefined}
          onAction={
            isActive && !isPublished
              ? () => onReleaseData(membership.anOrgId, draftPublication?.id)
              : undefined
          }
        />
        <ProcessStep
          number={4}
          label="Datenzugriff"
          detail={accessDetail}
          state={isRejected ? "locked" : accessState}
        />
      </div>
    </div>
  );
}

export function CollaborationProcessPanel({
  memberships,
  publications,
  getPartnerName,
  onInvite,
  onReleaseData,
}: Props) {
  return (
    <Card data-testid="collaboration-process" className="overflow-hidden border-primary/20">
      <CardHeader className="border-b border-border/60 bg-primary/5 pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="h-4 w-4 text-primary" />
              Projektzusammenarbeit
            </CardTitle>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              Einladung, aktive Projektmitgliedschaft, konkrete Leistungsfreigabe und
              AN-Nutzung sind voneinander getrennte Schritte. Eine Freigabe wartet
              auf die Annahme bzw. Nutzung durch den AN.
            </p>
          </div>
          <Button data-testid="collaboration-process-invite" size="sm" onClick={onInvite}>
            <UserPlus className="mr-1.5 h-4 w-4" />
            AN zum Projekt einladen
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 p-4">
        {memberships.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-sm">
            <p className="font-medium">Noch kein AN zum Projekt eingeladen</p>
            <p className="mt-1 text-muted-foreground">
              Leistungsfreigaben sind noch nicht verfügbar. Laden Sie zuerst einen AN
              ein und warten Sie auf die ausdrückliche Projektaufnahme.
            </p>
          </div>
        ) : (
          memberships.map((membership) => (
            <PartnerProcess
              key={membership.id}
              membership={membership}
              publications={publications}
              partnerName={getPartnerName(membership.anOrgId)}
              onReleaseData={onReleaseData}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}