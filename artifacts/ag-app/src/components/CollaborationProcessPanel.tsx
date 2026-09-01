import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Database,
  LockKeyhole,
  UserPlus,
  XCircle,
} from "lucide-react";
import type { DataPublication, ProjectMembership } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ProcessMembership = Pick<ProjectMembership, "id" | "anOrgId" | "status">;

interface Props {
  memberships: ProcessMembership[];
  publications: DataPublication[];
  getPartnerName: (anOrgId: string) => string;
  onInvite: () => void;
  onReleaseData: (anOrgId: string) => void;
}

type StepState = "complete" | "current" | "locked" | "rejected";

const STATE_STYLES: Record<StepState, string> = {
  complete: "border-emerald-500/30 bg-emerald-500/5",
  current: "border-primary/30 bg-primary/5",
  locked: "border-border bg-muted/20 opacity-75",
  rejected: "border-destructive/30 bg-destructive/5",
};

function publicationForPartner(publications: DataPublication[], anOrgId: string) {
  return [...publications]
    .filter((publication) =>
      publication.recipients?.some((recipient) => recipient.anOrgId === anOrgId),
    )
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
}

function recipientForPartner(publication: DataPublication | undefined, anOrgId: string) {
  return publication?.recipients?.find((recipient) => recipient.anOrgId === anOrgId);
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
  onReleaseData: (anOrgId: string) => void;
}) {
  const isActive = membership.status === "ACTIVE";
  const isRejected = membership.status === "REJECTED";
  const publication = publicationForPartner(publications, membership.anOrgId);
  const recipient = recipientForPartner(publication, membership.anOrgId);
  const isPublished = publication?.status === "PUBLISHED";
  const isAccepted = isPublished && recipient?.status === "ACCEPTED";
  const isOfferRejected = isPublished && recipient?.status === "REJECTED";

  const publicationDetail = !isActive
    ? "Gesperrt · erst nach aktiver Projektmitgliedschaft"
    : isPublished
      ? "Datenfreigabe veröffentlicht"
      : publication?.status === "DRAFT"
        ? "Datenfreigabe als Entwurf vorhanden"
        : "Noch keine Datenfreigabe veröffentlicht";

  const accessDetail = !isActive
    ? "Gesperrt · erst nach Datenfreigabe"
    : !isPublished
      ? "Gesperrt · erst nach veröffentlichter Datenfreigabe"
      : isAccepted
        ? "Datenzugriff akzeptiert"
        : isOfferRejected
          ? "Datenangebot vom AN abgelehnt"
          : "Datenangebot offen · AN muss die Nutzungsrichtlinie prüfen";

  return (
    <div
      data-testid={`collaboration-process-partner-${membership.anOrgId}`}
      className="rounded-xl border border-border bg-background/70 p-4"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{partnerName} · Datenraumprozess</p>
          <p className="text-xs text-muted-foreground">
            {isActive ? "Aktive Projektmitgliedschaft" : membership.status === "INVITED" ? "Einladung gesendet" : "Projektaufnahme abgelehnt"}
          </p>
        </div>
        <Badge
          variant={isActive ? "default" : isRejected ? "destructive" : "outline"}
          className="shrink-0"
        >
          {isActive ? "Mitgliedschaft aktiv" : isRejected ? "Abgelehnt" : "Einladung offen"}
        </Badge>
      </div>

      <div className="grid gap-2 md:grid-cols-4">
        <ProcessStep
          number={1}
          label="Einladung"
          detail={
            isRejected
              ? "Einladung abgelehnt"
              : isActive
                ? "Abgeschlossen"
                : "Gesendet · Warten auf Annahme durch AN"
          }
          state={isRejected ? "rejected" : isActive ? "complete" : "current"}
        />
        <ProcessStep
          number={2}
          label="Projektmitgliedschaft"
          detail={
            isRejected
              ? "Projektaufnahme abgelehnt"
              : isActive
                ? "Aktiv"
                : "Warten auf Annahme durch AN"
          }
          state={isRejected ? "rejected" : isActive ? "complete" : "current"}
        />
        <ProcessStep
          number={3}
          label="Datenfreigabe"
          detail={publicationDetail}
          state={isRejected ? "locked" : isPublished ? "complete" : isActive ? "current" : "locked"}
          action={isActive && !isPublished ? "Daten für AN freigeben" : undefined}
          onAction={isActive && !isPublished ? () => onReleaseData(membership.anOrgId) : undefined}
        />
        <ProcessStep
          number={4}
          label="Datenzugriff"
          detail={accessDetail}
          state={isRejected ? "locked" : isAccepted ? "complete" : isPublished ? "current" : "locked"}
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
              Zusammenarbeit im Datenraum
            </CardTitle>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              Einladung, Beitritt, separate Datenfreigabe und Datenzugriff sind vier
              voneinander getrennte Schritte. Daten werden erst nach aktiver
              Projektmitgliedschaft freigegeben.
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
              Datenfreigaben sind noch nicht verfügbar. Laden Sie zuerst einen AN
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