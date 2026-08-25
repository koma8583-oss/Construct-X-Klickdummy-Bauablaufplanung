import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
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

const STATUS_LABELS: Record<string, string> = {
  RECEIVED: "Eingegangen",
  DETAILS_RETRIEVED: "In Prüfung",
  UNDER_REVIEW: "In Prüfung",
  RESPONDED: "Antwort gesendet",
  REVISION_REQUIRED: "Überarbeitung erforderlich",
  CONFIRMED: "Bestätigt",
  CANCELLED: "Storniert",
  SUPERSEDED: "Ersetzt",
};

type LocalAnRequest = {
  id: string;
  status: string;
  guOrgId: string;
  plannedStart: string;
  plannedEnd: string;
  project?: { id: string; name: string | null };
  takt?: { gewerk: string | null; zone: string | null; taktBezeichnung: string | null };
};

export default function Requests() {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: requests, isLoading } = useQuery({
    queryKey: ["an-local-leistungsanfragen", statusFilter],
    queryFn: async (): Promise<LocalAnRequest[]> => {
      const params = statusFilter === "ALL" ? "" : `?status=${encodeURIComponent(statusFilter)}`;
      const response = await fetch(`/api/leistungsanfragen${params}`);
      if (!response.ok) throw new Error("Leistungsanfragen konnten nicht geladen werden");
      return response.json() as Promise<LocalAnRequest[]>;
    },
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
  });

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
              <SelectItem value="RECEIVED">Eingegangen</SelectItem>
              <SelectItem value="DETAILS_RETRIEVED">In Prüfung</SelectItem>
              <SelectItem value="UNDER_REVIEW">In Prüfung</SelectItem>
              <SelectItem value="RESPONDED">Antwort gesendet</SelectItem>
              <SelectItem value="REVISION_REQUIRED">Überarbeitung erforderlich</SelectItem>
              <SelectItem value="CONFIRMED">Bestätigt</SelectItem>
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
              {!requests || requests.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    {t("requests.empty")}
                  </TableCell>
                </TableRow>
              ) : (
                requests.map((request) => (
                  <TableRow key={request.id} className="border-border hover:bg-sidebar-accent/50 cursor-pointer">
                    <TableCell>
                      <Link href={`/takt-requests/${request.id}`} className="block">
                        <div className="font-medium text-foreground">
                          {request.project?.name ?? '-'}
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/takt-requests/${request.id}`} className="block">
                        <div className="font-medium text-foreground">
                          {request.takt?.gewerk}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {request.takt?.zone}{request.takt?.taktBezeichnung ? ` · ${request.takt.taktBezeichnung}` : ''}
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/takt-requests/${request.id}`} className="block">
                        {request.guOrgId}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/takt-requests/${request.id}`} className="block text-sm">
                        {format(new Date(request.plannedStart), 'dd.MM.yyyy')} - {format(new Date(request.plannedEnd), 'dd.MM.yyyy')}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/takt-requests/${request.id}`} className="block text-sm">
                        <span className="text-muted-foreground">Lokale Projektion</span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/takt-requests/${request.id}`} className="block">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">
                              {STATUS_LABELS[request.status] ?? request.status}
                            </Badge>
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
