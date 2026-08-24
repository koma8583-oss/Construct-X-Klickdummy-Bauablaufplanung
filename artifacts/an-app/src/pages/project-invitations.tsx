import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Building2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

type Invitation = {
  membership: { id: string; invitationMessage?: string | null; invitedAt: string; invitationExpiresAt?: string | null };
  project: { id: string; name: string; description?: string | null; location?: string | null };
  agOrganization: { name: string };
};

export default function ProjectInvitations() {
  const [items, setItems] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const { toast } = useToast();
  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/project-invitations");
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
      const response = await fetch(`/api/project-invitations/${id}/${action}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Aktion konnte nicht ausgeführt werden.");
      toast({ title: action === "accept" ? "Projekt angenommen" : "Einladung abgelehnt" });
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
      ) : items.map(({ membership, project, agOrganization }) => (
        <Card key={membership.id}>
          <CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5 text-primary" />{project.name}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">Einladung von <strong>{agOrganization.name}</strong></p>
            {project.location && <p className="text-sm">{project.location}</p>}
            {project.description && <p className="text-sm">{project.description}</p>}
            {membership.invitationMessage && <div className="rounded-md bg-muted/50 p-3 text-sm">{membership.invitationMessage}</div>}
            <div className="flex gap-2 pt-2">
              <Button disabled={busy === membership.id} onClick={() => void decide(membership.id, "accept")}><CheckCircle2 className="h-4 w-4 mr-2" />Annehmen</Button>
              <Button variant="outline" disabled={busy === membership.id} onClick={() => void decide(membership.id, "reject")}><XCircle className="h-4 w-4 mr-2" />Ablehnen</Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}