import { Link, useParams } from "wouter";
import { ArrowLeft, ChevronRight, Globe, ShieldCheck } from "lucide-react";
import { useGetPolicyTemplates } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buildPreviewOdrl } from "@/components/DataPublicationWizard";

function PolicyDetails({ policy }: { policy: NonNullable<ReturnType<typeof useGetPolicyTemplates>["data"]>[number] }) {
  return (
    <div className="space-y-4">
      {policy.description && <p>{policy.description}</p>}
      <p className="text-muted-foreground">{policy.purpose}</p>
      <div className="grid gap-4 md:grid-cols-2">
        <div><h3 className="mb-2 text-sm font-semibold">Erlaubt</h3><ul className="ml-5 list-disc space-y-1 text-sm">{policy.permissions.map((value) => <li key={value}>{value}</li>)}</ul></div>
        <div><h3 className="mb-2 text-sm font-semibold">Nicht erlaubt</h3><ul className="ml-5 list-disc space-y-1 text-sm">{policy.prohibitions.map((value) => <li key={value}>{value}</li>)}</ul></div>
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
  const { data: policies, isLoading, isError } = useGetPolicyTemplates();
  const selected = policies?.find((policy) => policy.code === code);

  if (code) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <Link href="/data-room/policies" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Zurück zum Datenraum</Link>
        {isLoading && <p className="text-muted-foreground">Policies werden geladen…</p>}
        {isError && <p className="text-destructive">Policies konnten nicht geladen werden.</p>}
        {!isLoading && !selected && <p className="text-muted-foreground">Policy nicht gefunden.</p>}
        {selected && <Card><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" />{selected.name}</CardTitle><p className="mt-1 text-xs text-muted-foreground">{selected.code}</p></div><Badge variant="secondary">Informativ</Badge></div></CardHeader><CardContent className="space-y-6"><PolicyDetails policy={selected} /><div><h2 className="mb-2 text-sm font-semibold">ODRL / JSON-LD</h2><pre className="max-h-[520px] overflow-auto rounded-lg bg-muted/50 p-4 text-[11px]">{JSON.stringify(buildPreviewOdrl(selected, "ag-org-preview"), null, 2)}</pre></div></CardContent></Card>}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div><h1 className="flex items-center gap-2 text-2xl font-bold"><Globe className="h-6 w-6 text-primary" />Datenraum</h1><p className="mt-1 text-sm text-muted-foreground">Übersicht der verfügbaren Nutzungsrichtlinien. Diese Ansicht ist rein informativ.</p></div>
      {isLoading && <p className="text-muted-foreground">Policies werden geladen…</p>}
      {isError && <p className="text-destructive">Policies konnten nicht geladen werden.</p>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {policies?.map((policy) => <Link key={policy.id} href={`/data-room/policies/${policy.code}`}><Card className="h-full transition-colors hover:border-primary/50 hover:bg-muted/20"><CardHeader><CardTitle className="flex items-start justify-between gap-2 text-base"><span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 shrink-0 text-primary" />{policy.name}</span><ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" /></CardTitle><p className="text-xs text-muted-foreground">{policy.code}</p></CardHeader><CardContent><p className="line-clamp-3 text-sm text-muted-foreground">{policy.description ?? policy.purpose}</p><div className="mt-4 flex flex-wrap gap-1"><Badge variant="outline">{policy.permissions.length} Erlaubnisse</Badge><Badge variant="outline">{policy.prohibitions.length} Verbote</Badge></div></CardContent></Card></Link>)}
      </div>
    </div>
  );
}