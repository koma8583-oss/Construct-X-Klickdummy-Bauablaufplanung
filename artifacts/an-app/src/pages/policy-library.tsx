import { Link, useParams } from "wouter";
import { useState } from "react";
import { ArrowLeft, ArrowUpRight, ChevronRight, Database, Globe, ShieldCheck } from "lucide-react";
import {
  type DataOfferSummary,
  useGetAnDataOffers,
  useListAnPolicies,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const PRODUCT_LABEL: Record<string, string> = {
  PROJECT_OVERVIEW: "Projektübersicht",
  PROJECT_COORDINATION_PACKAGE: "Koordinationspaket",
  TAKT_INFORMATION_PACKAGE: "Leistungsinformationspaket",
};

function isAuthError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("status" in error)) return false;
  const status = (error as { status?: unknown }).status;
  return status === 401 || status === 403;
}

function loadErrorMessage(error: unknown, subject: string): string {
  return isAuthError(error)
    ? "Ihre AN-Sitzung ist nicht mehr gültig. Bitte melden Sie sich erneut an."
    : `${subject} konnten nicht geladen werden. Bitte versuchen Sie es erneut.`;
}

function DataOfferCard({ offer }: { offer: DataOfferSummary }) {
  const isAccepted = offer.recipientStatus === "ACCEPTED";

  return (
    <Link href="/data-offers">
      <Card className="h-full transition-colors hover:border-primary/50 hover:bg-muted/20">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <CardTitle className="flex items-start gap-2 text-base">
              <Database className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>{offer.title}</span>
            </CardTitle>
            <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{offer.agName}</span>
            <span aria-hidden="true">·</span>
            <span>{PRODUCT_LABEL[offer.dataProductType] ?? offer.dataProductType}</span>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-1 text-sm">
            <div>
              <span className="text-xs text-muted-foreground">Projekt: </span>
              <span className="font-medium">{offer.projectReference}</span>
            </div>
            {offer.policyName && (
              <div>
                <span className="text-xs text-muted-foreground">Policy: </span>
                <span>{offer.policyName}</span>
              </div>
            )}
            {offer.validUntil && (
              <div className="text-xs text-muted-foreground">
                Gültig bis {new Intl.DateTimeFormat("de-DE").format(new Date(offer.validUntil))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            <Badge variant={isAccepted ? "secondary" : "default"}>
              {isAccepted ? "Policy akzeptiert" : "Aktion erforderlich"}
            </Badge>
            <Badge variant="outline">Freigegeben</Badge>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function PolicyDetails({ policy }: { policy: NonNullable<ReturnType<typeof useListAnPolicies>["data"]>[number] }) {
  return (
    <div className="space-y-4">
      {policy.description && <p>{policy.description}</p>}
      <p className="text-muted-foreground">{policy.purpose}</p>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold">Erlaubt</h3>
          <ul className="ml-5 list-disc space-y-1 text-sm">
            {policy.permissions.map((value) => <li key={value}>{value}</li>)}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold">Nicht erlaubt</h3>
          <ul className="ml-5 list-disc space-y-1 text-sm">
            {policy.prohibitions.map((value) => <li key={value}>{value}</li>)}
          </ul>
        </div>
      </div>
      <div className="grid gap-4 text-sm md:grid-cols-2">
        <p><strong>Gültigkeit:</strong> {policy.validityRule}</p>
        {policy.retentionRule && <p><strong>Aufbewahrung:</strong> {policy.retentionRule}</p>}
      </div>
    </div>
  );
}

export default function PolicyLibraryPage() {
  const { code } = useParams<{ code?: string }>();
  const {
    data: policies,
    isLoading,
    isError,
    error: policyError,
  } = useListAnPolicies();
  const {
    data: offers,
    isLoading: areOffersLoading,
    isError: areOffersError,
    error: offersError,
  } = useGetAnDataOffers();
  const [projectFilter, setProjectFilter] = useState("all");
  const selected = policies?.find((policy) => policy.code === code);
  const projects = policies?.flatMap((policy) => policy.projects) ?? [];
  const uniqueProjects = projects.filter(
    (project, index) => projects.findIndex((candidate) => candidate.id === project.id) === index,
  );
  const visiblePolicies = policies?.filter((policy) =>
    projectFilter === "all" || policy.projects.some((project) => project.id === projectFilter),
  );
  const visibleOffers = offers?.filter((offer) =>
    offer.publicationStatus === "PUBLISHED" &&
    (offer.recipientStatus === "OFFERED" || offer.recipientStatus === "ACCEPTED"),
  ) ?? [];

  if (code) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <Link href="/data-room/policies" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Zurück zum Datenraum
        </Link>
        {isLoading && <p className="text-muted-foreground">Policies werden geladen…</p>}
        {isError && <p className="text-destructive">{loadErrorMessage(policyError, "Policies")}</p>}
        {!isLoading && !selected && <p className="text-muted-foreground">Policy nicht gefunden.</p>}
        {selected && (
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" />{selected.name}</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">{selected.code}</p>
                </div>
                <Badge variant="secondary">Informativ</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <PolicyDetails policy={selected} />
              <div>
                <h2 className="mb-2 text-sm font-semibold">ODRL / JSON-LD</h2>
                <pre className="max-h-[520px] overflow-auto rounded-lg bg-muted/50 p-4 text-[11px]">{JSON.stringify(selected.odrl, null, 2)}</pre>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold"><Globe className="h-6 w-6 text-primary" />Datenraum</h1>
        <p className="mt-1 text-sm text-muted-foreground">Ihre akzeptierten Policies und die für Ihre Organisation freigegebenen Datensätze.</p>
      </div>

      <section className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Akzeptierte Policies
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Nutzungsrichtlinien, die für Ihre Organisation und die jeweiligen Projekte gelten.
            </p>
          </div>
        </div>
        {isLoading && <p className="text-sm text-muted-foreground">Policies werden geladen…</p>}
        {isError && <p className="text-sm text-destructive">{loadErrorMessage(policyError, "Policies")}</p>}
        {!isLoading && !isError && policies?.length === 0 && (
          <div className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
            Aktuell sind keine Policies akzeptiert.
          </div>
        )}
      {policies && policies.length > 0 && (
        <div className="max-w-sm space-y-2">
          <label htmlFor="policy-project-filter" className="text-sm font-medium">Nach AG-Projekt filtern</label>
          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger id="policy-project-filter"><SelectValue placeholder="Alle Projekte" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Projekte</SelectItem>
              {uniqueProjects.map((project) => (
                <SelectItem key={project.id} value={project.id}>{project.agName} · {project.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {policies && policies.length > 0 && visiblePolicies?.length === 0 && (
        <p className="text-muted-foreground">Für dieses Projekt aktuell keine vereinbart.</p>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visiblePolicies?.map((policy) => (
          <Link key={policy.id} href={`/data-room/policies/${policy.code}`}>
            <Card className="h-full transition-colors hover:border-primary/50 hover:bg-muted/20">
              <CardHeader>
                <CardTitle className="flex items-start justify-between gap-2 text-base">
                  <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 shrink-0 text-primary" />{policy.name}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </CardTitle>
                <p className="text-xs text-muted-foreground">{policy.code}</p>
              </CardHeader>
              <CardContent>
                <p className="line-clamp-3 text-sm text-muted-foreground">{policy.description ?? policy.purpose}</p>
                <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                  <div className="font-medium text-foreground">Akzeptiert für:</div>
                  {policy.projects.map((project) => <div key={project.id}>{project.agName} · {project.name}</div>)}
                </div>
                <div className="mt-4 flex flex-wrap gap-1">
                  <Badge variant="outline">{policy.permissions.length} Erlaubnisse</Badge>
                  <Badge variant="outline">{policy.prohibitions.length} Verbote</Badge>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Database className="h-5 w-5 text-primary" />
              Für Sie freigegebene Datensätze
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Veröffentlichte Projektdaten, die von Auftraggebern an Ihre Organisation adressiert wurden.
            </p>
          </div>
          <Link href="/data-offers" className="whitespace-nowrap text-sm text-primary hover:underline">
            Alle Angebote öffnen
          </Link>
        </div>
        {areOffersLoading && <p className="text-sm text-muted-foreground">Datensätze werden geladen…</p>}
        {areOffersError && <p className="text-sm text-destructive">{loadErrorMessage(offersError, "Freigegebene Datensätze")}</p>}
        {!areOffersLoading && !areOffersError && visibleOffers.length === 0 && (
          <div className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
            Aktuell sind keine Datensätze für Ihre Organisation freigegeben.
          </div>
        )}
        {visibleOffers.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleOffers.map((offer) => <DataOfferCard key={offer.publicationId} offer={offer} />)}
          </div>
        )}
      </section>
    </div>
  );
}