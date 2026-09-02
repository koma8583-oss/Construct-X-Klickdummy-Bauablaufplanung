import { useMemo, useState } from "react";
import { CalendarDays, GitBranch, List, LockKeyhole, Network, PackageCheck } from "lucide-react";
import { useGetAnDataOffers, useGetDataOfferContent, type DataOfferContent, type DataOfferSummary } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type ViewMode = "list" | "gantt" | "network";
type SnapshotItem = Record<string, unknown> & {
  plannedTimeWindow?: { start?: string | null; end?: string | null };
  predecessors?: string[];
  successors?: string[];
};

function dateLabel(value: unknown) {
  if (typeof value !== "string" || !value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function itemLabel(item: SnapshotItem, index: number) {
  return String(item.kurzbezeichnung ?? item.workPackage ?? item.taktBezeichnung ?? `Leistung ${index + 1}`);
}

function snapshotItems(content: DataOfferContent | undefined): SnapshotItem[] {
  const items = content?.content?.takte;
  return Array.isArray(items) ? items.filter((item): item is SnapshotItem => !!item && typeof item === "object") : [];
}

function ReleaseSelector({
  offers,
  selectedId,
  onSelect,
}: {
  offers: DataOfferSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {offers.map((offer) => (
        <button
          key={offer.publicationId}
          type="button"
          onClick={() => onSelect(offer.publicationId)}
          className={`rounded-xl border p-4 text-left transition-colors ${
            selectedId === offer.publicationId
              ? "border-primary bg-primary/5 shadow-sm"
              : "border-border bg-card hover:border-primary/40"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{offer.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {offer.projectName ?? "Projektname nicht veröffentlicht"}
              </p>
            </div>
            <Badge variant="secondary" className="shrink-0 text-[10px]">Version {offer.version}</Badge>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>Freigegeben am {dateLabel(offer.notifiedAt)}</span>
            <span>{offer.validUntil ? `Gültig bis ${dateLabel(offer.validUntil)}` : "Unbegrenzt gültig"}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

function ListView({ items }: { items: SnapshotItem[] }) {
  return (
    <div className="space-y-2">
      {items.map((item, index) => {
        const window = item.plannedTimeWindow;
        return (
          <div key={`${itemLabel(item, index)}-${index}`} className="rounded-lg border bg-card px-4 py-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-medium">{itemLabel(item, index)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {[item.trade, item.location, item.zone].filter((value) => typeof value === "string" && value).join(" · ") || "Keine Zusatzangaben veröffentlicht"}
                </p>
              </div>
              <div className="text-left text-xs text-muted-foreground sm:text-right">
                <p>{dateLabel(window?.start)} – {dateLabel(window?.end)}</p>
                {typeof item.bufferTimeWindow === "object" && item.bufferTimeWindow !== null && (
                  <p className="mt-1">Puffer berücksichtigt</p>
                )}
              </div>
            </div>
            {typeof item.executionNotes === "string" && item.executionNotes && (
              <p className="mt-2 border-t pt-2 text-xs text-muted-foreground">{item.executionNotes}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function GanttView({ items }: { items: SnapshotItem[] }) {
  const dated = items
    .map((item, index) => ({ item, index, start: new Date(item.plannedTimeWindow?.start ?? "").getTime(), end: new Date(item.plannedTimeWindow?.end ?? "").getTime() }))
    .filter((entry) => Number.isFinite(entry.start) && Number.isFinite(entry.end) && entry.end >= entry.start);
  if (!dated.length) return <EmptyView text="Für diese Freigabe sind keine Zeiträume veröffentlicht." />;

  const min = Math.min(...dated.map((entry) => entry.start));
  const max = Math.max(...dated.map((entry) => entry.end));
  const span = Math.max(max - min, 86_400_000);
  return (
    <div className="space-y-3 overflow-x-auto">
      <div className="min-w-[620px] space-y-2">
        {dated.map(({ item, index, start, end }) => (
          <div key={`${itemLabel(item, index)}-${index}`} className="grid grid-cols-[170px_1fr] items-center gap-3">
            <div className="truncate text-xs font-medium">{itemLabel(item, index)}</div>
            <div className="relative h-8 rounded-md bg-muted/50">
              <div
                className="absolute inset-y-1 rounded bg-primary px-2 text-[10px] font-medium leading-6 text-primary-foreground"
                style={{ left: `${((start - min) / span) * 100}%`, width: `${Math.max(((end - start) / span) * 100, 2)}%` }}
                title={`${dateLabel(item.plannedTimeWindow?.start)} – ${dateLabel(item.plannedTimeWindow?.end)}`}
              >
                <span className="block truncate">{dateLabel(item.plannedTimeWindow?.start)} – {dateLabel(item.plannedTimeWindow?.end)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NetworkView({ items }: { items: SnapshotItem[] }) {
  const labels = useMemo(() => new Map(items.map((item, index) => [String(item.id ?? index), itemLabel(item, index)])), [items]);
  return (
    <div className="space-y-3">
      {items.map((item, index) => {
        const predecessors = Array.isArray(item.predecessors) ? item.predecessors : [];
        const successors = Array.isArray(item.successors) ? item.successors : [];
        return (
          <div key={`${itemLabel(item, index)}-${index}`} className="rounded-lg border bg-card px-4 py-3">
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 shrink-0 text-primary" />
              <p className="text-sm font-medium">{itemLabel(item, index)}</p>
            </div>
            <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">Vorgänger:</span>{" "}
                {predecessors.length ? predecessors.map((id) => labels.get(id) ?? "Veröffentlichte Leistung").join(", ") : "Keine"}
              </p>
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">Nachfolger:</span>{" "}
                {successors.length ? successors.map((id) => labels.get(id) ?? "Veröffentlichte Leistung").join(", ") : "Keine"}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EmptyView({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">{text}</div>;
}

export default function LeistungenPage() {
  const { data: offers, isLoading: offersLoading } = useGetAnDataOffers();
  const acceptedOffers = (offers ?? []).filter(
    (offer) => offer.recipientStatus === "ACCEPTED" && offer.publicationStatus === "PUBLISHED" && offer.dataProductType === "TAKT_INFORMATION_PACKAGE",
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const activeId = selectedId && acceptedOffers.some((offer) => offer.publicationId === selectedId)
    ? selectedId
    : acceptedOffers[0]?.publicationId;
  const { data: content, isLoading: contentLoading, isError: contentError } = useGetDataOfferContent(activeId, !!activeId);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const items = snapshotItems(content);
  const selectedOffer = acceptedOffers.find((offer) => offer.publicationId === activeId);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col gap-3 border-b border-border/70 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.22em] text-primary">Arbeitsgrundlage</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Freigegebene Leistungen</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Hier erscheinen ausschließlich Leistungen aus einer akzeptierten Leistungsfreigabe. Interne Planungsdaten des Auftraggebers bleiben verborgen.
          </p>
        </div>
        <PackageCheck className="hidden h-9 w-9 text-primary/70 sm:block" />
      </header>

      {offersLoading && <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>}

      {!offersLoading && acceptedOffers.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <LockKeyhole className="h-10 w-10 text-muted-foreground/50" />
            <h2 className="text-lg font-semibold">Noch keine Leistungen freigeschaltet</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              Nach aktiver Projektmitgliedschaft werden veröffentlichte Leistungsfreigaben im Datenraum angezeigt. Erst nach deiner Akzeptanz werden die enthaltenen Leistungen hier geöffnet.
            </p>
            <Button variant="outline" asChild><a href="/data-room">Zum Datenraum</a></Button>
          </CardContent>
        </Card>
      )}

      {acceptedOffers.length > 0 && (
        <>
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Akzeptierte Leistungsfreigaben</h2>
                <p className="text-xs text-muted-foreground">Wähle die veröffentlichte Version, die du prüfen möchtest.</p>
              </div>
              <Badge variant="secondary">{acceptedOffers.length} aktiv</Badge>
            </div>
            <ReleaseSelector offers={acceptedOffers} selectedId={activeId ?? null} onSelect={setSelectedId} />
          </section>

          <Card>
            <CardHeader className="gap-4 pb-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base">{selectedOffer?.title ?? "Leistungen"}</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  {items.length} veröffentlichte {items.length === 1 ? "Leistung" : "Leistungen"} · Version {content?.version ?? selectedOffer?.version}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
                {([
                  ["list", "Liste", List],
                  ["gantt", "Gantt", CalendarDays],
                  ["network", "Netzplan", Network],
                ] as const).map(([id, label, Icon]) => (
                  <Button key={id} variant={viewMode === id ? "secondary" : "ghost"} size="sm" className="gap-1 px-2 text-xs" onClick={() => setViewMode(id)}>
                    <Icon className="h-3.5 w-3.5" />{label}
                  </Button>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              {contentLoading && <div className="space-y-2"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>}
              {contentError && <EmptyView text="Die akzeptierte Leistungsfreigabe konnte nicht geladen werden." />}
              {!contentLoading && !contentError && items.length === 0 && <EmptyView text="Diese Version enthält keine veröffentlichten Leistungen." />}
              {!contentLoading && !contentError && items.length > 0 && viewMode === "list" && <ListView items={items} />}
              {!contentLoading && !contentError && items.length > 0 && viewMode === "gantt" && <GanttView items={items} />}
              {!contentLoading && !contentError && items.length > 0 && viewMode === "network" && <NetworkView items={items} />}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}