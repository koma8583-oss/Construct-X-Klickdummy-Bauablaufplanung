import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type Proposal = { id: string; start: string; end: string; comment?: string | null } | null;
type Coordination = { openProposal: Proposal; currentAgreement?: { start: string; end: string } | null; nextActionOwner?: 'AG' | 'AN' | null };

const day = (value: string) => `${value}T00:00:00.000Z`;
const errorText = (error: unknown) => {
  const e = error as { data?: { error?: string }; message?: string };
  return e?.data?.error || e?.message || 'Die Aktion konnte nicht ausgeführt werden.';
};
async function apiFetch<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'include', ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || 'Die Aktion konnte nicht ausgeführt werden.'), { data: body });
  return body as T;
}

export function ProposalActions({ requestId }: { requestId: string }) {
  const queryClient = useQueryClient();
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { data, refetch } = useQuery({
    queryKey: ['/api/leistungsanfragen', requestId, 'coordination'],
    queryFn: () => apiFetch<Coordination>(`/api/leistungsanfragen/${requestId}/coordination`),
  });
  const proposal = data?.openProposal;
  const canAct = !!data?.currentAgreement && (!data?.nextActionOwner || data.nextActionOwner === 'AG');

  const refresh = async () => {
    await Promise.all([
      refetch(),
      queryClient.invalidateQueries({ queryKey: ['/api/takt-requests', requestId] }),
      queryClient.invalidateQueries({ queryKey: [`/api/takt-requests/${requestId}`] }),
      queryClient.invalidateQueries({ queryKey: [`/api/leistungsanfragen/${requestId}`] }),
    ]);
  };
  const submit = async (action: 'accept' | 'reject' | 'counter' | 'propose') => {
    setError('');
    if ((action === 'counter' || action === 'propose') && !data?.currentAgreement) {
      setError('Ein Änderungsvorschlag ist erst nach einer bestätigten Terminvereinbarung möglich.');
      return;
    }
    if ((action === 'counter' || action === 'propose') && (!start || !end)) {
      setError('Bitte geben Sie Beginn und Ende des Zeitraums an.');
      return;
    }
    if ((action === 'counter' || action === 'propose') && end < start) {
      setError('Das Ende darf nicht vor dem Beginn liegen.');
      return;
    }
    setBusy(true);
    try {
      const base = `/api/leistungsanfragen/${requestId}/change-proposals`;
      if (action === 'accept' || action === 'reject') {
        await apiFetch(`${base}/${proposal!.id}/${action}`, { method: 'POST' });
      } else {
        await apiFetch(action === 'counter' ? `${base}/${proposal!.id}/counter` : base, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ start: day(start), end: day(end), comment: comment || null, action: action === 'counter' ? 'COUNTER' : 'PROPOSE', supersedesProposalId: proposal?.id ?? null }),
        });
      }
      setStart(''); setEnd(''); setComment('');
      await refresh();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  if (!data || (!proposal && !canAct)) return null;
  return (
    <section className="mt-5 rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-4">
      <div>
        <h3 className="font-semibold">Zeitraum abstimmen</h3>
        <p className="text-sm text-muted-foreground">
          {proposal ? `Offener Vorschlag: ${new Date(proposal.start).toLocaleDateString('de-DE')} – ${new Date(proposal.end).toLocaleDateString('de-DE')}` : 'Sie können einen Zeitraum vorschlagen.'}
        </p>
      </div>
      {proposal && canAct && <div className="flex flex-col sm:flex-row gap-2">
        <Button size="sm" className="w-full sm:w-auto" onClick={() => submit('accept')} disabled={busy}><CheckCircle2 className="mr-1.5 h-4 w-4" />Annehmen</Button>
        <Button size="sm" className="w-full sm:w-auto" variant="outline" onClick={() => submit('reject')} disabled={busy}><XCircle className="mr-1.5 h-4 w-4" />Ablehnen</Button>
      </div>}
      {canAct && <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Beginn<input type="date" value={start} onChange={e => setStart(e.target.value)} className="mt-1 flex h-10 w-full rounded-md border bg-background px-3 text-sm" /></label>
        <label className="text-sm">Ende<input type="date" value={end} onChange={e => setEnd(e.target.value)} className="mt-1 flex h-10 w-full rounded-md border bg-background px-3 text-sm" /></label>
        <Textarea className="sm:col-span-2" value={comment} onChange={e => setComment(e.target.value)} placeholder="Kommentar (optional)" maxLength={2000} />
        <Button className="w-full sm:col-span-2" variant="secondary" onClick={() => submit(proposal ? 'counter' : 'propose')} disabled={busy}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRightLeft className="mr-2 h-4 w-4" />}
          {proposal ? 'Gegenvorschlag senden' : 'Zeitraum vorschlagen'}
        </Button>
      </div>}
      {proposal && !canAct && <p className="text-sm text-muted-foreground">Der Vorschlag wurde gesendet. Die Gegenseite ist jetzt am Zug.</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </section>
  );
}