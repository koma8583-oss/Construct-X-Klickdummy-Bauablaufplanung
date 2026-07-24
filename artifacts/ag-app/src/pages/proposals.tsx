import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'wouter';
import { format } from 'date-fns';
import { 
  useListDelegations,
  getListDelegationsQueryKey
} from '@workspace/api-client-react';
import { Briefcase, AlertTriangle, ChevronRight, Clock, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function Proposals() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<'ALL' | 'CRITICAL'>('ALL');

  const { data: delegations, isLoading } = useListDelegations(
    { status: 'ALTERNATIVE_PROPOSED' }, 
    { query: { queryKey: getListDelegationsQueryKey({ status: 'ALTERNATIVE_PROPOSED' }) } }
  );

  const filteredDelegations = delegations?.filter(d => {
    if (filter === 'CRITICAL') return d.isWithinBuffer === false;
    return true;
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">All Proposals</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Review alternative date proposals from contractors across all projects.
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <Select value={filter} onValueChange={(v: 'ALL' | 'CRITICAL') => setFilter(v)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter proposals" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Proposals</SelectItem>
              <SelectItem value="CRITICAL">Critical Only</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : filteredDelegations?.length === 0 ? (
        <div className="text-center py-16 px-4 border border-dashed rounded-xl border-border bg-card/50">
          <Clock className="w-12 h-12 mx-auto text-muted-foreground mb-4 opacity-50" />
          <h3 className="text-lg font-medium">No pending proposals</h3>
          <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto">
            {filter === 'CRITICAL' 
              ? "There are no critical proposals outside the buffer window."
              : "There are no alternative proposals requiring your review at this time."}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredDelegations?.map(delegation => (
            <Link key={delegation.id} href={`/projects/${delegation.projectId}/proposals`}>
              <Card className="hover:border-primary/50 transition-colors cursor-pointer group bg-card overflow-hidden">
                <div className="flex flex-col sm:flex-row">
                  {/* Status indicator strip */}
                  <div className={`w-1.5 shrink-0 ${delegation.isWithinBuffer === false ? 'bg-destructive' : 'bg-primary'}`} />
                  
                  <CardContent className="p-4 flex-1 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="space-y-1.5 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-lg group-hover:text-primary transition-colors">
                          Takt {delegation.takt?.taktNumber} - {delegation.takt?.gewerk}
                        </span>
                        {delegation.isWithinBuffer === false && (
                          <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">Critical</Badge>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        <span className="flex items-center text-foreground">
                          <Briefcase className="w-3.5 h-3.5 mr-1" />
                          {delegation.takt?.projectId ? 'Project ID: ' + delegation.takt.projectId.substring(0,8) : 'Unknown Project'}
                        </span>
                        <span className="flex items-center">
                          <MapPin className="w-3.5 h-3.5 mr-1" />
                          Zone: {delegation.takt?.zone}
                        </span>
                      </div>
                      
                      <div className="text-sm text-muted-foreground pt-1">
                        From: <span className="font-medium text-foreground">{delegation.anOrganization?.name || 'Contractor'}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-6 sm:pl-4 sm:border-l border-border/50">
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider font-semibold">Requested vs Proposed</div>
                        <div className="text-sm line-through opacity-70">
                          {format(new Date(delegation.requestedStart), 'MMM d')} - {format(new Date(delegation.requestedEnd), 'MMM d')}
                        </div>
                        {/* We don't have the response data directly in the delegation list without joining, 
                            so we just indicate there's a proposal to review. The actual dates are seen on the project proposals page. */}
                        <div className="text-sm font-medium text-primary mt-0.5">
                          Review Alternative
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-transform group-hover:translate-x-1" />
                    </div>
                  </CardContent>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
