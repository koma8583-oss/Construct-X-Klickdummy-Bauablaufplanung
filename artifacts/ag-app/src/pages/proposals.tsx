import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'wouter';
import { format } from 'date-fns';
import {
  useListTaktRequests,
  getListTaktRequestsQueryKey
} from '@workspace/api-client-react';
import { Briefcase, AlertTriangle, ChevronRight, Clock, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function Proposals() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<'ALL' | 'OVERDUE'>('ALL');

  const { data: taktRequests, isLoading } = useListTaktRequests(
    { status: 'ALTERNATIVES_PROPOSED' },
    { query: { queryKey: getListTaktRequestsQueryKey({ status: 'ALTERNATIVES_PROPOSED' }), refetchInterval: 30_000 } }
  );

  const now = new Date();

  const filteredRequests = taktRequests?.filter(req => {
    if (filter === 'OVERDUE') {
      return req.guDecisionRequiredBy != null && new Date(req.guDecisionRequiredBy) < now;
    }
    return true;
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">All Proposals</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Review alternative date proposals from contractors across all projects.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Select value={filter} onValueChange={(v: 'ALL' | 'OVERDUE') => setFilter(v)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter proposals" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Proposals</SelectItem>
              <SelectItem value="OVERDUE">Decision Overdue</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : filteredRequests?.length === 0 ? (
        <div className="text-center py-16 px-4 border border-dashed rounded-xl border-border bg-card/50">
          <Clock className="w-12 h-12 mx-auto text-muted-foreground mb-4 opacity-50" />
          <h3 className="text-lg font-medium">No pending proposals</h3>
          <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto">
            {filter === 'OVERDUE'
              ? "There are no proposals where your decision deadline has passed."
              : "There are no alternative proposals requiring your review at this time."}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredRequests?.map(req => {
            const isOverdue =
              req.guDecisionRequiredBy != null && new Date(req.guDecisionRequiredBy) < now;

            return (
              <Link key={req.id} href={`/leistungsanfragen/${req.id}`}>
                <Card className="hover:border-primary/50 transition-colors cursor-pointer group bg-card overflow-hidden">
                  <div className="flex flex-col sm:flex-row">
                    {/* Status indicator strip */}
                    <div className={`w-1.5 shrink-0 ${isOverdue ? 'bg-destructive' : 'bg-primary'}`} />

                    <CardContent className="p-4 flex-1 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                      <div className="space-y-1.5 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-lg group-hover:text-primary transition-colors">
                            {req.taktBezeichnung}
                          </span>
                          {isOverdue && (
                            <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">Decision Overdue</Badge>
                          )}
                        </div>

                        <div className="flex items-center gap-3 text-sm text-muted-foreground">
                          <span className="flex items-center text-foreground">
                            <Briefcase className="w-3.5 h-3.5 mr-1" />
                            {req.projectName}
                          </span>
                          <span className="text-xs font-mono text-muted-foreground">{req.requestNumber}</span>
                        </div>

                        <div className="text-sm text-muted-foreground pt-1">
                          From: <span className="font-medium text-foreground">{req.nuOrgName}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-6 sm:pl-4 sm:border-l border-border/50">
                        <div className="text-right">
                          {req.guDecisionRequiredBy ? (
                            <>
                              <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider font-semibold">
                                Decision by
                              </div>
                              <div className={`text-sm font-medium ${isOverdue ? 'text-destructive' : 'text-foreground'}`}>
                                {format(new Date(req.guDecisionRequiredBy), 'MMM d, yyyy')}
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider font-semibold">
                                Received
                              </div>
                              <div className="text-sm font-medium text-foreground">
                                {format(new Date(req.updatedAt), 'MMM d, yyyy')}
                              </div>
                            </>
                          )}
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
            );
          })}
        </div>
      )}
    </div>
  );
}
