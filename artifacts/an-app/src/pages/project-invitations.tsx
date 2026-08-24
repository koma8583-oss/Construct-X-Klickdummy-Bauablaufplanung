import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Building2, Loader2, ShieldCheck, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

type Invitation = {
  id: string;
  senderAgOrgId: string;
  projectName: string;
  projectReference: string;
  projectDescription?: string | null;
  projectLocation?: string | null;
  invitationMessage?: string | null;
  invitationExpiresAt?: string | null;
  dataPublicationTitle?: string | null;
  selectedFields?: string[] | null;
  policySnapshot: {
    name?: string; code?: string; purpose?: string; permissions?: string[];
    prohibitions?: string[]; validityRule?: string; retentionRule?: string | null;
  };
};

export default function ProjectInvitations() {
  const [items, setItems] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [policyConfirmed, setPolicyConfirmed] = useState<Record<string, boolean>>({});
  const { toast } = useToast();
  const load = async () => {
    setLoading(true);
    try {
       const response = await fetch("/api/an/project-invitations");
      if (!response.ok) throw new Error("Einladungen konnten nicht geladen werden.");
      setItems(await response.json());
    } catch (error) {
      toast({ title: "Fehler", description: (error as Error).message, variant: "destructive" });
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const decide = async (id: string, action: "accept" | "reject") => {
    setBusy(id);
    try {
       const response = await fetch(`/api/an/project-invitations/${id}/${action}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ policyAccepted: action === "accept" ? policyConfirmed[id] === true : undefined }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Aktion konnte nicht ausgeführt werden.");
      toast({ title: action === "accept" ? "Projekt und Datenfreigabe angenommen" : "Einladung abgelehnt" });
      await load();
    } catch (error) {
      toast({ title: "Fehler", description: (error as Error).message, variant: "destructive" });
    } finally { setBusy(null); }
  };
  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div><h1 className="text-2xl font-semibold">Projekteinladungen</h1><p className="text-muted-foreground">Bestätigen Sie, an welchen Projekten Ihr Unternehmen teilnehmen soll.</p></div>
      {loading ? <Loader2 className="h-6 w-6 animate-spin text-primary" /> : items.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Keine offenen Projekteinladungen.</CardContent></Card>
       ) : items.map((invitation) => (
         <Card key={invitation.id}>
           <CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5 text-primary" />{invitation.projectName}</CardTitle></CardHeader>
           <CardContent className="space-y-4">
             <p className="text-sm text-muted-foreground">Einladung vom Auftraggeber <strong>{invitation.senderAgOrgId}</strong></p>
             {invitation.projectLocation && <p className="text-sm">{invitation.projectLocation}</p>}
             {invitation.projectDescription && <p className="text-sm">{invitation.projectDescription}</p>}
             {invitation.invitationMessage && <div className="rounded-md bg-muted/50 p-3 text-sm">{invitation.invitationMessage}</div>}
             {invitation.dataPublicationTitle && (
               <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
                 <div className="flex items-center gap-2 font-medium text-sm"><Lock className="h-4 w-4 text-primary" />Datenangebot: {invitation.dataPublicationTitle}</div>
                 <div className="flex flex-wrap gap-1">{invitation.selectedFields?.map((field) => <Badge key={field} variant="secondary" className="text-[10px]">{field}</Badge>)}</div>
               </div>
             )}
             <div className="rounded-lg border p-3 space-y-2 text-sm">
               <div className="flex items-center gap-2 font-medium"><ShieldCheck className="h-4 w-4 text-primary" />{invitation.policySnapshot.name ?? "Nutzungsrichtlinie"}</div>
               {invitation.policySnapshot.purpose && <p className="text-muted-foreground">{invitation.policySnapshot.purpose}</p>}
               {invitation.policySnapshot.permissions?.length ? <p><strong>Erlaubt:</strong> {invitation.policySnapshot.permissions.join(", ")}</p> : null}
               {invitation.policySnapshot.prohibitions?.length ? <p><strong>Nicht erlaubt:</strong> {invitation.policySnapshot.prohibitions.join(", ")}</p> : null}
               {invitation.policySnapshot.validityRule && <p><strong>Bedingungen:</strong> {invitation.policySnapshot.validityRule}</p>}
             </div>
             <label className="flex items-start gap-2 cursor-pointer rounded-md border p-3">
               <Checkbox checked={policyConfirmed[invitation.id] === true} onCheckedChange={(checked) => setPolicyConfirmed((state) => ({ ...state, [invitation.id]: checked === true }))} />
               <span className="text-sm">Ich bestätige die angezeigte Nutzungsrichtlinie. Projektmitgliedschaft und Datenzugriff werden erst danach aktiviert.</span>
             </label>
             <div className="flex gap-2 pt-1">
               <Button disabled={busy === invitation.id || !policyConfirmed[invitation.id]} onClick={() => void decide(invitation.id, "accept")}><CheckCircle2 className="h-4 w-4 mr-2" />Annehmen</Button>
               <Button variant="outline" disabled={busy === invitation.id} onClick={() => void decide(invitation.id, "reject")}><XCircle className="h-4 w-4 mr-2" />Ablehnen</Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}