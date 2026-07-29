import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useListDelegations, DelegationStatus } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { TaktStatusBadge } from "@/components/takt-status-badge";

export default function Requests() {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: delegations, isLoading } = useListDelegations(
    { status: statusFilter === "ALL" ? undefined : (statusFilter as DelegationStatus) },
    { query: { refetchInterval: 5_000 } as any }
  );

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl font-bold text-foreground">{t("requests.title")}</h1>
        
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{t("requests.filterStatus")}:</span>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px] bg-background">
              <SelectValue placeholder={t("requests.filterStatus")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t("requests.all")}</SelectItem>
              <SelectItem value="PENDING">{t("common.status.PENDING")}</SelectItem>
              <SelectItem value="CONFIRMED">{t("common.status.CONFIRMED")}</SelectItem>
              <SelectItem value="ALTERNATIVE_PROPOSED">{t("common.status.ALTERNATIVE_PROPOSED")}</SelectItem>
              <SelectItem value="REJECTED">{t("common.status.REJECTED")}</SelectItem>
              <SelectItem value="CANCELLED">{t("common.status.CANCELLED")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="bg-card border-border">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead>{t("requests.detail.project")}</TableHead>
                <TableHead>{t("requests.detail.gewerk")} / {t("requests.detail.zone")}</TableHead>
                <TableHead>{t("requests.detail.ag")}</TableHead>
                <TableHead>{t("requests.detail.requestedDates")}</TableHead>
                <TableHead>{t("requests.detail.bufferWindow")}</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!delegations || delegations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    {t("requests.empty")}
                  </TableCell>
                </TableRow>
              ) : (
                delegations.map((del) => (
                  <TableRow key={del.id} className="border-border hover:bg-sidebar-accent/50 cursor-pointer">
                    <TableCell>
                      <Link href={`/requests/${del.id}`} className="block">
                        <div className="font-medium text-foreground">
                          {del.project?.name ?? '-'}
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/requests/${del.id}`} className="block">
                        <div className="font-medium text-foreground">
                          {del.takt?.gewerk}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {del.takt?.zone}{del.takt?.taktBezeichnung ? ` · ${del.takt.taktBezeichnung}` : ''}
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/requests/${del.id}`} className="block">
                        {del.agOrganization?.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/requests/${del.id}`} className="block text-sm">
                        {format(new Date(del.requestedStart), 'dd.MM.yyyy')} - {format(new Date(del.requestedEnd), 'dd.MM.yyyy')}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/requests/${del.id}`} className="block text-sm">
                        {del.earliestStart && del.latestEnd ? (
                          <>
                            {format(new Date(del.earliestStart), 'dd.MM.')} - {format(new Date(del.latestEnd), 'dd.MM.')}
                          </>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/requests/${del.id}`} className="block">
                        <div className="flex flex-col gap-1">
                          {del.takt?.status && (
                            <TaktStatusBadge status={del.takt.status} />
                          )}
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className={`
                              ${del.status === 'PENDING' ? 'border-amber-500/50 text-amber-500' : ''}
                              ${del.status === 'CONFIRMED' ? 'border-emerald-500/50 text-emerald-500' : ''}
                              ${del.status === 'ALTERNATIVE_PROPOSED' ? 'border-blue-500/50 text-blue-500' : ''}
                              ${del.status === 'REJECTED' ? 'border-red-500/50 text-red-500' : ''}
                              ${del.status === 'CANCELLED' ? 'border-slate-400/50 text-slate-400' : ''}
                            `}>
                              {t(`common.status.${del.status}`)}
                            </Badge>
                            {del.isWithinBuffer !== null && del.isWithinBuffer !== undefined && (
                              <div 
                                className={`w-2 h-2 rounded-full ${del.isWithinBuffer ? 'bg-emerald-500' : 'bg-red-500'}`} 
                                title={del.isWithinBuffer ? t("requests.withinBuffer") : t("requests.outsideBuffer")}
                              />
                            )}
                          </div>
                        </div>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
