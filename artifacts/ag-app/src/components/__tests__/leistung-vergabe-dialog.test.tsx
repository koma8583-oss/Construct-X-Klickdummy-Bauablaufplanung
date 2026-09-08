import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LeistungVergabeDialog } from '@/components/LeistungVergabeDialog';

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({ checked, disabled, onCheckedChange }: {
    checked?: boolean;
    disabled?: boolean;
    onCheckedChange?: (checked: boolean) => void;
  }) => (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onCheckedChange?.(event.currentTarget.checked)}
    />
  ),
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: {
    value: string;
    onValueChange: (value: string) => void;
    children: React.ReactNode;
  }) => <select aria-label="Fachlicher Zweck" value={value} onChange={(event) => onValueChange(event.target.value)}>{children}</select>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => <option value="">Zweck auswählen…</option>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}));

vi.mock('@/components/date-picker', () => ({
  DatePicker: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <input aria-label="Antwortfrist" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));

const parentAgreement = (effectivePolicy: Record<string, unknown>) => ({
  id: 'parent-policy-7',
  version: 7,
  lifecycleStatus: 'ACCEPTED' as const,
  effectivePolicy,
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('LeistungVergabeDialog Parent-Policy contract', () => {
  it('hides unsupported purposes, parent-excluded fields and inherited project fields', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      items: [{ taktId: 'takt-1', deltaClass: 'WITHIN_BASELINE', inheritedEffectivePolicy: {}, diff: { summary: [] } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const onSubmit = vi.fn();
    const user = userEvent.setup();

    render(
      <LeistungVergabeDialog
        open
        onOpenChange={vi.fn()}
        taktId="takt-1"
        partners={[{
          anOrgId: 'an-1',
          label: 'Baupartner',
          parentAgreement: parentAgreement({
            allowedPurposes: ['RAHMENTERMINE', 'NICHT_UNTERSTUETZT'],
            allowedFieldScope: ['plannedTimeWindow', 'resourceRequirements', 'projectLocation'],
          }),
        }]}
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole('checkbox', { name: /Baupartner/i }));
    expect(screen.queryByRole('option', { name: 'Leistung koordinieren' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Fachlicher Zweck'), { target: { value: 'RAHMENTERMINE' } });

    expect(await screen.findByText('Geplanter Zeitraum')).toBeInTheDocument();
    expect(screen.queryByText('Ressourcenbedarf')).not.toBeInTheDocument();
    expect(screen.queryByText(/Projektstandort/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Vorschau prüfen' }));
    await user.click(screen.getByRole('button', { name: 'Vergeben' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      recipients: [{
        nuOrgId: 'an-1',
        parentPolicyId: 'parent-policy-7',
        parentPolicyVersion: 7,
      }],
      purpose: 'RAHMENTERMINE',
      selectedFields: ['plannedTimeWindow'],
    })));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      purpose: 'RAHMENTERMINE',
      selectedFields: ['plannedTimeWindow'],
      parentPolicyId: 'parent-policy-7',
      parentPolicyVersion: 7,
    });
  });

  it('submits exactly the user-selected subset that was previewed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      items: [{ taktId: 'takt-2', deltaClass: 'WITHIN_BASELINE', inheritedEffectivePolicy: {}, diff: { summary: [] } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const onSubmit = vi.fn();
    const user = userEvent.setup();

    render(
      <LeistungVergabeDialog
        open
        onOpenChange={vi.fn()}
        taktId="takt-2"
        partners={[{
          anOrgId: 'an-2',
          label: 'Ausbau GmbH',
          parentAgreement: parentAgreement({
            allowedPurposes: ['LEISTUNGSKOORDINATION'],
            allowedFieldScope: ['plannedTimeWindow', 'requiredOutput'],
          }),
        }]}
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole('checkbox', { name: /Ausbau GmbH/i }));
    fireEvent.change(screen.getByLabelText('Fachlicher Zweck'), { target: { value: 'LEISTUNGSKOORDINATION' } });
    await user.click(await screen.findByRole('checkbox', { name: 'Leistungsbeschreibung' }));
    await user.click(screen.getByRole('button', { name: 'Vorschau prüfen' }));
    await user.click(screen.getByRole('button', { name: 'Vergeben' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      purpose: 'LEISTUNGSKOORDINATION',
      selectedFields: ['plannedTimeWindow'],
      recipients: [{
        nuOrgId: 'an-2',
        parentPolicyId: 'parent-policy-7',
        parentPolicyVersion: 7,
      }],
    })));
  });

  it('binds each selected Nachunternehmen to its own Parent-Policy', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({
      items: [{ taktId: 'takt-3', deltaClass: 'WITHIN_BASELINE', inheritedEffectivePolicy: {}, diff: { summary: [] } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <LeistungVergabeDialog
        open
        onOpenChange={vi.fn()}
        taktId="takt-3"
        partners={[
          {
            anOrgId: 'an-a',
            label: 'Partner A',
            parentAgreement: { ...parentAgreement({ allowedPurposes: ['RAHMENTERMINE'] }), id: 'policy-a', version: 2 },
          },
          {
            anOrgId: 'an-b',
            label: 'Partner B',
            parentAgreement: { ...parentAgreement({ allowedPurposes: ['RAHMENTERMINE'] }), id: 'policy-b', version: 4 },
          },
        ]}
        onSubmit={onSubmit}
      />,
    );
    await user.click(screen.getByRole('checkbox', { name: /Partner A/i }));
     await user.click(screen.getByRole('checkbox', { name: /Partner B/i }));
    fireEvent.change(screen.getByLabelText('Fachlicher Zweck'), { target: { value: 'RAHMENTERMINE' } });
    await user.click(screen.getByRole('button', { name: 'Vorschau prüfen' }));
    await user.click(screen.getByRole('button', { name: 'Vergeben' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      recipients: [
        { nuOrgId: 'an-a', parentPolicyId: 'policy-a', parentPolicyVersion: 2 },
        { nuOrgId: 'an-b', parentPolicyId: 'policy-b', parentPolicyVersion: 4 },
      ],
    })));
  });
});