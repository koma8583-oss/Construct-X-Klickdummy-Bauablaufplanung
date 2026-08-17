import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useParams } from "wouter";
import { 
  useGetDelegation, 
  useListDelegationResponses, 
  useCreateDelegationResponse,
  getGetDelegationQueryKey,
  getListDelegationResponsesQueryKey,
  getListDelegationsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, ArrowLeft, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { format, differenceInDays, isWithinInterval } from "date-fns";
import { TaktStatusBadge } from "@/components/takt-status-badge";

export default function RequestDetail() {
  const { delegationId } = useParams<{ delegationId: string }>();
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: delegation, isLoading: isDelegationLoading } = useGetDelegation(
    delegationId!,
    { query: { refetchInterval: 5_000, refetchIntervalInBackground: false } as any }
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: responses, isLoading: isResponsesLoading } = useListDelegationResponses(
    delegationId!,
    { query: { refetchInterval: 5_000, refetchIntervalInBackground: false } as any }
  );
  const createResponse = useCreateDelegationResponse();

  const [proposedStart, setProposedStart] = useState("");
  const [proposedEnd, setProposedEnd] = useState("");
  const [comment, setComment] = useState("");
  const [rejectComment, setRejectComment] = useState("");
  const [isProposing, setIsProposing] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);

  if (isDelegationLoading || isResponsesLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!delegation) return null;

  const handleConfirm = async () => {
    await createResponse.mutateAsync({
      delegationId,
      data: { type: "CONFIRMED" }
    });
    queryClient.invalidateQueries({ queryKey: getGetDelegationQueryKey(delegationId) });
    queryClient.invalidateQueries({ queryKey: getListDelegationResponsesQueryKey(delegationId) });
    queryClient.invalidateQueries({ queryKey: getListDelegationsQueryKey() });
  };

  const handlePropose = async () => {
    await createResponse.mutateAsync({
      delegationId,
      data: { 
        type: "ALTERNATIVE",
        proposedStart: new Date(proposedStart).toISOString(),
        proposedEnd: new Date(proposedEnd).toISOString(),
        comment
      }
    });
    setIsProposing(false);
    queryClient.invalidateQueries({ queryKey: getGetDelegationQueryKey(delegationId) });
    queryClient.invalidateQueries({ queryKey: getListDelegationResponsesQueryKey(delegationId) });
    queryClient.invalidateQueries({ queryKey: getListDelegationsQueryKey() });
  };

  const handleReject = async () => {
    await createResponse.mutateAsync({
      delegationId,
      data: { 
        type: "REJECTED",
        comment: rejectComment
      }
    });
    setIsRejecting(false);
    queryClient.invalidateQueries({ queryKey: getGetDelegationQueryKey(delegationId) });
    queryClient.invalidateQueries({ queryKey: getListDelegationResponsesQueryKey(delegationId) });
    queryClient.invalidateQueries({ queryKey: getListDelegationsQueryKey() });
  };

  const isWithinBufferCalc = proposedStart && proposedEnd && delegation.earliestStart && delegation.latestEnd
    ? isWithinInterval(new Date(proposedStart), { start: new Date(delegation.earliestStart), end: new Date(delegation.latestEnd) }) &&
      isWithinInterval(new Date(proposedEnd), { start: new Date(delegation.earliestStart), end: new Date(delegation.latestEnd) })
    : null;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/requests")} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {delegation.takt?.gewerk} – {delegation.takt?.zone}
          </h1>
          <p className="text-sm text-muted-foreground">
            {delegation.project?.name && (
              <span className="font-medium text-foreground/70">{delegation.project.name} · </span>
            )}
            {delegation.takt?.taktBezeichnung}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Panel 1: Takt Info */}
        <Card className="bg-card border-border lg:col-span-1">
          <CardHeader>
            <CardTitle>{t("requests.detail.taktInfo")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {delegation.takt?.status && (
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1">Takt-Status</div>
                <TaktStatusBadge status={delegation.takt.status} />
              </div>
            )}
            {delegation.project?.name && (
              <div>
                <div className="text-sm font-medium text-muted-foreground">{t("requests.detail.project")}</div>
                <div className="text-foreground">{delegation.project.name}</div>
              </div>
            )}
            <div>
              <div className="text-sm font-medium text-muted-foreground">{t("requests.detail.ag")}</div>
              <div className="text-foreground">{delegation.agOrganization?.name}</div>
            </div>
            {delegation.takt && (
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <div>
                  <div className="text-sm font-medium text-muted-foreground">{t("requests.detail.gewerk")}</div>
                  <div className="text-foreground">{delegation.takt.gewerk}</div>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground">{t("requests.detail.zone")}</div>
                  <div className="text-foreground">{delegation.takt.zone}</div>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground">{t("requests.detail.taktNumber")}</div>
                  <div className="text-foreground">{delegation.takt.taktBezeichnung}</div>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground">{t("requests.detail.plannedDates")}</div>
                  <div className="text-foreground text-sm">
                    {format(new Date(delegation.takt.plannedStart), 'dd.MM.yyyy')} – {format(new Date(delegation.takt.plannedEnd), 'dd.MM.yyyy')}
                  </div>
                </div>
              </div>
            )}
            <div>
              <div className="text-sm font-medium text-muted-foreground">{t("requests.detail.requestedDates")}</div>
              <div className="text-foreground">
                {format(new Date(delegation.requestedStart), 'dd.MM.yyyy')} – {format(new Date(delegation.requestedEnd), 'dd.MM.yyyy')}
              </div>
            </div>
            {(delegation.earliestStart || delegation.latestEnd) && (
              <div>
                <div className="text-sm font-medium text-muted-foreground">{t("requests.detail.bufferWindow")}</div>
                <div className="text-foreground">
                  {delegation.earliestStart ? format(new Date(delegation.earliestStart), 'dd.MM.yyyy') : '-'} bis{' '}
                  {delegation.latestEnd ? format(new Date(delegation.latestEnd), 'dd.MM.yyyy') : '-'}
                </div>
              </div>
            )}
            {delegation.message && (
              <div>
                <div className="text-sm font-medium text-muted-foreground">{t("requests.detail.agMessage")}</div>
                <div className="text-sm text-foreground mt-1 p-2 bg-sidebar-accent/50 rounded border border-border whitespace-pre-wrap">
                  {delegation.message}
                </div>
              </div>
            )}
            {delegation.takt?.description && (
              <div>
                <div className="text-sm font-medium text-muted-foreground">{t("requests.detail.description")}</div>
                <div className="text-sm text-foreground mt-1 whitespace-pre-wrap">{delegation.takt.description}</div>
              </div>
            )}
            {delegation.takt?.requiredResources && (
              <div>
                <div className="text-sm font-medium text-muted-foreground">{t("requests.detail.requiredResources")}</div>
                <div className="text-sm text-foreground mt-1 whitespace-pre-wrap">{delegation.takt.requiredResources}</div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Panel 2 & 3 */}
        <div className="lg:col-span-2 space-y-6">
          {/* Timeline Visual (Simplified) */}
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle>{t("requests.detail.timeline")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative h-24 bg-sidebar-accent/30 rounded border border-border p-4 flex flex-col justify-center overflow-hidden">
                {/* Just a symbolic representation for now, real scale requires full date math */}
                <div className="text-xs text-muted-foreground mb-2 flex justify-between w-full">
                  <span>{delegation.earliestStart ? format(new Date(delegation.earliestStart), 'dd.MM.') : ''}</span>
                  <span>{delegation.latestEnd ? format(new Date(delegation.latestEnd), 'dd.MM.') : ''}</span>
                </div>
                {/* Buffer Band */}
                {(delegation.earliestStart && delegation.latestEnd) && (
                  <div className="absolute top-8 left-0 right-0 h-8 bg-emerald-500/10 border-y border-emerald-500/20" />
                )}
                {/* Requested Band */}
                <div className="relative h-4 bg-primary rounded z-10 mx-[20%]" title="Requested">
                  <div className="absolute -top-5 left-0 text-[10px] text-primary-foreground font-bold whitespace-nowrap">
                    {format(new Date(delegation.requestedStart), 'dd.MM.')}
                  </div>
                  <div className="absolute -top-5 right-0 text-[10px] text-primary-foreground font-bold whitespace-nowrap">
                    {format(new Date(delegation.requestedEnd), 'dd.MM.')}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Cancelled Banner */}
          {delegation.status === 'CANCELLED' && (
            <Card className="bg-card border-border border-l-4 border-l-slate-400">
              <CardContent className="flex items-center gap-3 p-4">
                <XCircle className="h-5 w-5 text-slate-400 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-foreground">Vergabe storniert</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Der Auftraggeber hat diese Vergabe zurückgezogen. Es ist keine weitere Aktion erforderlich.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Response Panel */}
          {delegation.status === 'PENDING' && !isProposing && !isRejecting && (
            <Card className="bg-card border-border border-l-4 border-l-amber-500">
              <CardHeader>
                <CardTitle>{t("requests.detail.response")}</CardTitle>
              </CardHeader>
              <CardContent className="flex gap-4">
                <Button onClick={handleConfirm} className="bg-emerald-500 hover:bg-emerald-600 text-white">
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  {t("common.confirm")}
                </Button>
                <Button variant="outline" onClick={() => setIsProposing(true)} className="border-blue-500 text-blue-500 hover:bg-blue-500/10">
                  {t("common.proposeAlternative")}
                </Button>
                <Button variant="outline" onClick={() => setIsRejecting(true)} className="border-red-500 text-red-500 hover:bg-red-500/10 ml-auto">
                  <XCircle className="w-4 h-4 mr-2" />
                  {t("common.reject")}
                </Button>
              </CardContent>
            </Card>
          )}

          {isProposing && (
            <Card className="bg-card border-border border-l-4 border-l-blue-500">
              <CardHeader>
                <CardTitle>{t("requests.detail.proposeTitle")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Start</Label>
                    <Input type="date" value={proposedStart} onChange={e => setProposedStart(e.target.value)} className="bg-background" />
                  </div>
                  <div className="space-y-2">
                    <Label>Ende</Label>
                    <Input type="date" value={proposedEnd} onChange={e => setProposedEnd(e.target.value)} className="bg-background" />
                  </div>
                </div>
                
                {isWithinBufferCalc !== null && (
                  <div className={`p-3 rounded text-sm flex items-center gap-2 ${isWithinBufferCalc ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                    <AlertCircle className="h-4 w-4" />
                    {isWithinBufferCalc ? t("requests.withinBuffer") : t("requests.outsideBuffer")}
                  </div>
                )}

                <div className="space-y-2">
                  <Label>{t("requests.detail.commentLabel")}</Label>
                  <Textarea value={comment} onChange={e => setComment(e.target.value)} className="bg-background" />
                </div>
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" onClick={() => setIsProposing(false)}>{t("common.cancel")}</Button>
                  <Button onClick={handlePropose} disabled={!proposedStart || !proposedEnd || createResponse.isPending} className="bg-blue-500 hover:bg-blue-600 text-white">
                    {createResponse.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    {t("common.save")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {isRejecting && (
            <Card className="bg-card border-border border-l-4 border-l-red-500">
              <CardHeader>
                <CardTitle>{t("common.reject")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>{t("requests.detail.commentLabel")}</Label>
                  <Textarea value={rejectComment} onChange={e => setRejectComment(e.target.value)} className="bg-background" placeholder="Begründung (optional)" />
                </div>
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" onClick={() => setIsRejecting(false)}>{t("common.cancel")}</Button>
                  <Button variant="destructive" onClick={handleReject} disabled={createResponse.isPending}>
                    {createResponse.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Anfrage endgültig ablehnen
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* History */}
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle>{t("requests.detail.history")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {responses?.length === 0 ? (
                <p className="text-sm text-muted-foreground">Kein Verlauf vorhanden.</p>
              ) : (
                responses?.map((res) => (
                  <div key={res.id} className="p-4 rounded border border-border bg-sidebar-accent/50 space-y-2">
                    <div className="flex justify-between items-start">
                      <div className="font-semibold text-sm">
                        {res.type === 'CONFIRMED' && <span className="text-emerald-500">Bestätigt</span>}
                        {res.type === 'ALTERNATIVE' && <span className="text-blue-500">Alternative vorgeschlagen</span>}
                        {res.type === 'REJECTED' && <span className="text-red-500">Abgelehnt</span>}
                      </div>
                      <div className="text-xs text-muted-foreground">{format(new Date(res.createdAt), 'dd.MM.yyyy HH:mm')}</div>
                    </div>
                    {res.proposedStart && res.proposedEnd && (
                      <div className="text-sm text-muted-foreground">
                        Termine: {format(new Date(res.proposedStart), 'dd.MM.yyyy')} - {format(new Date(res.proposedEnd), 'dd.MM.yyyy')}
                      </div>
                    )}
                    {res.comment && (
                      <div className="text-sm mt-2 p-2 bg-background rounded border border-border">
                        {res.comment}
                      </div>
                    )}
                    {res.agDecision && res.agDecision !== 'PENDING' && (
                      <div className={`mt-2 text-sm font-medium ${res.agDecision === 'ACCEPTED' ? 'text-emerald-500' : 'text-red-500'}`}>
                        AG Entscheidung: {res.agDecision === 'ACCEPTED' ? 'Akzeptiert' : 'Abgelehnt'}
                        {res.agComment && <span className="block font-normal mt-1 text-muted-foreground">{res.agComment}</span>}
                      </div>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
