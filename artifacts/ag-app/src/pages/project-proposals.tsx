import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, Link } from 'wouter';
import { format } from 'date-fns';
import { 
  useGetProject, 
  useListDelegations,
  useListDelegationResponses,
  useUpdateDelegationResponse,
  getListDelegationsQueryKey,
  getListDelegationResponsesQueryKey,
  getGetProjectQueryKey
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, X, AlertTriangle, MessageSquare, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

export default function ProjectProposals() {
  const { projectId } = useParams<{ projectId: string }>();
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: project } = useGetProject(projectId, { 
    query: { enabled: !!projectId, queryKey: getGetProjectQueryKey(projectId) } 
  });

  const { data: delegations, isLoading } = useListDelegations(
    { projectId, status: 'ALTERNATIVE_PROPOSED' }, 
    { query: { enabled: !!projectId, queryKey: getListDelegationsQueryKey({ projectId, status: 'ALTERNATIVE_PROPOSED' }) } }
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center gap-4">
        <Link href={`/projects/${projectId}`}>
          <Button variant="outline" size="icon" className="h-9 w-9">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Proposals</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Review alternative date proposals from contractors for {project?.name}
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2].map(i => <Skeleton key={i} className="h-48 w-full" />)}
        </div>
      ) : delegations?.length === 0 ? (
        <div className="text-center py-16 px-4 border border-dashed rounded-xl border-border bg-card/50">
          <Check className="w-12 h-12 mx-auto text-muted-foreground mb-4 opacity-50" />
          <h3 className="text-lg font-medium">No pending proposals</h3>
          <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto">
            There are no alternative proposals requiring your review at this time.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {delegations?.map(delegation => (
            <DelegationProposalCard key={delegation.id} delegation={delegation} />
          ))}
        </div>
      )}
    </div>
  );
}

function DelegationProposalCard({ delegation }: { delegation: any }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');

  const { data: responses } = useListDelegationResponses(delegation.id, {
    query: { enabled: !!delegation.id, queryKey: getListDelegationResponsesQueryKey(delegation.id) }
  });

  const updateResponse = useUpdateDelegationResponse();

  const activeResponse = responses?.find(r => r.agDecision === 'PENDING' || r.agDecision === null);

  const handleDecision = (decision: 'ACCEPTED' | 'REJECTED') => {
    if (!activeResponse) return;

    updateResponse.mutate({
      delegationId: delegation.id,
      responseId: activeResponse.id,
      data: {
        agDecision: decision,
        agComment: comment || undefined
      }
    }, {
      onSuccess: () => {
        toast({ title: `Proposal ${decision.toLowerCase()}` });
        queryClient.invalidateQueries({ queryKey: getListDelegationsQueryKey({ projectId: delegation.projectId, status: 'ALTERNATIVE_PROPOSED' }) });
        queryClient.invalidateQueries({ queryKey: getListDelegationResponsesQueryKey(delegation.id) });
      },
      onError: (err) => {
        toast({ title: 'Error', description: err.message, variant: 'destructive' });
      }
    });
  };

  if (!activeResponse) return null;

  const isCritical = !activeResponse.isWithinBuffer;

  return (
    <Card className={`bg-card overflow-hidden ${isCritical ? 'border-destructive/50' : 'border-border'}`}>
      {isCritical && (
        <div className="bg-destructive text-destructive-foreground text-xs font-semibold px-4 py-1.5 flex items-center">
          <AlertTriangle className="w-3.5 h-3.5 mr-2" />
          CRITICAL: Proposed dates outside available buffer window
        </div>
      )}
      <CardHeader className="pb-3 border-b border-border/50 bg-background/50">
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="text-lg">
              {delegation.takt?.taktBezeichnung} · {delegation.takt?.gewerk}
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Contractor: <span className="font-medium text-foreground">{delegation.anOrganization?.name}</span>
            </p>
          </div>
          <Badge variant="outline" className="font-mono bg-background">
            Zone: {delegation.takt?.zone}
          </Badge>
        </div>
      </CardHeader>
      
      <CardContent className="pt-5 space-y-6">
        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Original Request</h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-muted/30 rounded border border-border/50">
                <div className="text-xs text-muted-foreground mb-1">Requested Start</div>
                <div className="font-medium">{format(new Date(delegation.requestedStart), 'MMM d, yyyy')}</div>
              </div>
              <div className="p-3 bg-muted/30 rounded border border-border/50">
                <div className="text-xs text-muted-foreground mb-1">Requested End</div>
                <div className="font-medium">{format(new Date(delegation.requestedEnd), 'MMM d, yyyy')}</div>
              </div>
            </div>

            {(delegation.earliestStart || delegation.latestEnd) && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-background border border-border/50 p-2 rounded">
                <Clock className="w-3.5 h-3.5" />
                Buffer: 
                <span className="font-medium text-foreground">
                  {delegation.earliestStart ? format(new Date(delegation.earliestStart), 'MMM d') : 'Open'} - 
                  {delegation.latestEnd ? format(new Date(delegation.latestEnd), 'MMM d') : 'Open'}
                </span>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <h4 className="text-sm font-semibold uppercase tracking-wider text-primary">Contractor Proposal</h4>
            <div className="grid grid-cols-2 gap-4">
              <div className={`p-3 rounded border ${isCritical ? 'bg-destructive/10 border-destructive/30' : 'bg-primary/10 border-primary/30'}`}>
                <div className={`text-xs mb-1 ${isCritical ? 'text-destructive' : 'text-primary'}`}>Proposed Start</div>
                <div className="font-medium text-foreground">
                  {activeResponse.proposedStart ? format(new Date(activeResponse.proposedStart), 'MMM d, yyyy') : '-'}
                </div>
              </div>
              <div className={`p-3 rounded border ${isCritical ? 'bg-destructive/10 border-destructive/30' : 'bg-primary/10 border-primary/30'}`}>
                <div className={`text-xs mb-1 ${isCritical ? 'text-destructive' : 'text-primary'}`}>Proposed End</div>
                <div className="font-medium text-foreground">
                  {activeResponse.proposedEnd ? format(new Date(activeResponse.proposedEnd), 'MMM d, yyyy') : '-'}
                </div>
              </div>
            </div>

            {activeResponse.comment && (
              <div className="flex gap-2 text-sm bg-muted/20 p-3 rounded border border-border/50">
                <MessageSquare className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <p className="italic text-muted-foreground">"{activeResponse.comment}"</p>
              </div>
            )}
          </div>
        </div>

        {/* Timeline Visualization */}
        <div className="mt-6 pt-4 border-t border-border/50">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">Timeline Comparison</div>
          <div className="relative h-16 bg-muted/20 rounded-lg border border-border/50 px-4 flex items-center">
            {/* Visual representation logic would go here in a real implementation */}
            <div className="text-xs text-muted-foreground text-center w-full">
              Timeline visualization available in details view
            </div>
          </div>
        </div>
      </CardContent>

      <CardFooter className="bg-muted/10 border-t border-border/50 p-4 flex flex-col sm:flex-row gap-4 items-stretch sm:items-start">
        <Textarea 
          placeholder="Add a comment with your decision (optional)..."
          className="resize-none h-[42px] sm:flex-1"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <div className="flex gap-2 sm:shrink-0 justify-end">
          <Button 
            variant="outline" 
            className="border-destructive text-destructive hover:bg-destructive/10"
            onClick={() => handleDecision('REJECTED')}
            disabled={updateResponse.isPending}
          >
            <X className="w-4 h-4 mr-2" />
            Reject
          </Button>
          <Button 
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={() => handleDecision('ACCEPTED')}
            disabled={updateResponse.isPending}
          >
            <Check className="w-4 h-4 mr-2" />
            Accept
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}
