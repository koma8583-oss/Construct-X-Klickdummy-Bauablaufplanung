import { ArrowLeft, Calendar, Clock, MapPin } from 'lucide-react';
import { format } from 'date-fns';
import { Link, useParams } from 'wouter';
import { useGetProject, useListTakte, getGetProjectQueryKey, getListTakteQueryKey } from '@workspace/api-client-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Entwurf',
  PLANNED: 'Geplant',
  IN_PROGRESS: 'In Bearbeitung',
  COMPLETED: 'Abgeschlossen',
  CANCELLED: 'Abgebrochen',
};

export default function TaktDetail() {
  const { projectId = '', taktId = '' } = useParams<{ projectId: string; taktId: string }>();
  const { data: project } = useGetProject(projectId, { query: { enabled: !!projectId, queryKey: getGetProjectQueryKey(projectId) } });
  const { data: takte, isLoading } = useListTakte(projectId, { query: { enabled: !!projectId, queryKey: getListTakteQueryKey(projectId) } });
  const takt = takte?.find((item) => item.id === taktId);

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!takt) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-4">
        <Button asChild variant="ghost" className="-ml-3">
          <Link href={`/projects/${projectId}`}><ArrowLeft className="w-4 h-4 mr-2" />Zurück zum Projekt</Link>
        </Button>
        <h1 className="text-2xl font-semibold">Leistung nicht gefunden</h1>
        <p className="text-muted-foreground">Die ausgewählte Leistung ist in diesem Projekt nicht mehr verfügbar.</p>
      </div>
    );
  }

  const projectName = project?.name ?? 'Projekt';
  const durationDays = (takt as { durationDays?: string | number | null }).durationDays;
  const start = new Date(takt.plannedStart);
  const end = new Date(takt.plannedEnd);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      <div>
        <Button asChild variant="ghost" className="-ml-3 mb-6">
          <Link href={`/projects/${projectId}`}><ArrowLeft className="w-4 h-4 mr-2" />Zurück zum Projekt</Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground mb-2">{projectName} · Leistung</p>
            <h1 className="text-3xl font-semibold tracking-tight">{takt.taktBezeichnung}</h1>
            <p className="text-lg text-muted-foreground mt-1">{takt.gewerk}</p>
          </div>
          <Badge variant="outline" className="text-sm px-3 py-1">
            {STATUS_LABEL[takt.status] ?? takt.status}
          </Badge>
        </div>
      </div>

      <Card>
        <CardContent className="p-6">
          <div className="grid gap-6 sm:grid-cols-3">
            <div className="flex items-start gap-3">
              <Calendar className="w-5 h-5 text-primary mt-0.5" />
              <div>
                <p className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">Planzeitraum</p>
                <p className="font-medium mt-1">{format(start, 'dd.MM.yyyy')} – {format(end, 'dd.MM.yyyy')}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <MapPin className="w-5 h-5 text-primary mt-0.5" />
              <div>
                <p className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">Zone</p>
                <p className="font-medium mt-1">{takt.zone}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Clock className="w-5 h-5 text-primary mt-0.5" />
              <div>
                <p className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">Dauer</p>
                <p className="font-medium mt-1">{durationDays ? `${durationDays} Arbeitstage` : 'Nicht angegeben'}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {takt.description && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Beschreibung</h2>
          <p className="text-base leading-7">{takt.description}</p>
        </section>
      )}
    </div>
  );
}