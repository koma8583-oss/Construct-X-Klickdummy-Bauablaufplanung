import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataPublicationWizard } from "@/components/DataPublicationWizard";
import type { Takt } from "@workspace/api-client-react";

const mocks = vi.hoisted(() => ({
  createBatch: vi.fn(),
  send: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ user: { orgId: "ag-1" } }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useCreateTaktRequestBatchWithSnapshot: () => ({
    mutateAsync: mocks.createBatch,
    isPending: false,
  }),
  useSendTaktRequest: () => ({
    mutateAsync: mocks.send,
    isPending: false,
  }),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    onClick,
    id,
  }: {
    checked?: boolean;
    onCheckedChange?: () => void;
    onClick?: React.MouseEventHandler<HTMLInputElement>;
    id?: string;
  }) => (
    <input
      id={id}
      type="checkbox"
      checked={checked}
      onChange={onCheckedChange}
      onClick={onClick}
      readOnly
    />
  ),
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children }: { children: React.ReactNode }) => <label>{children}</label>,
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children: React.ReactNode;
  }) => (
    <select value={value} onChange={(event) => onValueChange?.(event.target.value)}>
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

vi.mock("@/components/date-picker", () => ({
  DatePicker: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => <input type="date" value={value} onChange={(event) => onChange(event.target.value)} />,
}));

type Contractors = React.ComponentProps<typeof DataPublicationWizard>["contractors"];

const policy = (id: string, allowedFieldScope = ["kurzbezeichnung", "workPackage", "trade"]) => ({
  id,
  lifecycleStatus: "ACCEPTED",
  effectivePolicy: {
    projectReference: "campus-west",
    allowedPurposes: ["RAHMENTERMINE"],
    allowedFieldScope,
    validFrom: "2026-09-01",
  },
});

const activeContractor = (overrides: Partial<Contractors[number]> = {}): Contractors[number] => ({
  id: "contractor-1",
  orgId: "an-1",
  name: "Baupartner",
  assignmentStatus: "ACTIVE",
  projectAgreementPolicyId: "agreement-1",
  projectAgreementStatus: "ACCEPTED",
  parentAgreement: policy("agreement-1"),
  ...overrides,
});

const campusTakte: Takt[] = ["L-101", "L-102", "L-103"].map((id, index) => ({
  id,
  projectId: "campus-west",
  taktBezeichnung: id,
  kurzbezeichnung: `Leistung ${id}`,
  gewerk: "Rohbau",
  plannedStart: `2026-09-${10 + index}`,
  plannedEnd: `2026-09-${12 + index}`,
  status: "GEPLANT",
  createdAt: "2026-08-01T00:00:00.000Z",
}));

async function moveToReview(user: ReturnType<typeof userEvent.setup>, taktCount = 1) {
  await user.click(screen.getByRole("button", { name: /Baupartner/ }));
  await user.click(screen.getByRole("button", { name: /Weiter/ }));
  await user.selectOptions(screen.getByRole("combobox"), "RAHMENTERMINE");
  await user.click(screen.getByRole("button", { name: /Weiter/ }));
  for (const checkbox of screen.getAllByRole("checkbox").slice(0, taktCount)) await user.click(checkbox);
  await user.click(screen.getByRole("button", { name: /Weiter/ }));
  await user.click(screen.getByRole("button", { name: /Weiter/ }));
}

describe("DataPublicationWizard", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses the ordered Leistungsfreigabe flow without DataPublication", async () => {
    const user = userEvent.setup();
    mocks.createBatch.mockResolvedValue({ requests: [{ id: "request-1" }] });
    mocks.send.mockResolvedValue({ status: "DELIVERED" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ taktId: "takt-1", deltaClass: "WITHIN_BASELINE", inheritedEffectivePolicy: {}, diff: { changed: [], summary: [] } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <DataPublicationWizard
        open
        onOpenChange={vi.fn()}
        projectId="project-1"
        projectName="Testprojekt"
        contractors={[{
          id: "contractor-1",
          orgId: "an-1",
          name: "Baupartner",
          assignmentStatus: "ACTIVE",
          projectAgreementPolicyId: "agreement-1",
          projectAgreementStatus: "ACCEPTED",
          parentAgreement: {
            id: "agreement-1",
            lifecycleStatus: "ACCEPTED",
            effectivePolicy: {
              projectReference: "project-1",
              allowedPurposes: ["RAHMENTERMINE"],
              allowedFieldScope: ["kurzbezeichnung", "workPackage", "trade"],
            },
          },
        }]}
        takte={[{
          id: "takt-1",
          projectId: "project-1",
          taktBezeichnung: "T1",
          kurzbezeichnung: "Fundament Nord",
          gewerk: "Rohbau",
          plannedStart: "2026-09-10",
          plannedEnd: "2026-09-12",
          status: "GEPLANT",
          createdAt: "2026-08-01T00:00:00.000Z",
        }]}
        initialRecipientIds={["an-1"]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Baupartner/ }));
    expect(screen.getByTestId("parent-agreement")).toHaveTextContent("agreement-1");
    await user.click(screen.getByRole("button", { name: /Weiter/ }));
    await user.selectOptions(screen.getByRole("combobox"), "RAHMENTERMINE");
    await user.click(screen.getByRole("button", { name: /Weiter/ }));
    await user.click(screen.getAllByRole("checkbox")[0]);
    await user.click(screen.getByRole("button", { name: /Weiter/ }));
    expect(screen.getByTestId("inherited-policy-context")).toHaveTextContent("Aus akzeptierter Projektvereinbarung übernommen");
    expect(screen.queryByText("Benötigte Ressourcen")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Weiter/ }));
    expect(await screen.findByTestId("policy-preview")).toHaveTextContent("WITHIN_BASELINE");
    expect(fetchMock).toHaveBeenCalledWith("/api/leistungsanfragen/policy-preview", expect.objectContaining({ method: "POST" }));
    await user.click(screen.getByRole("button", { name: "Senden" }));
    expect(mocks.createBatch).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      purpose: "RAHMENTERMINE",
      selectedFields: expect.not.arrayContaining(["resourceRequirements"]),
    }) }));
    expect(mocks.send).toHaveBeenCalledWith({ requestId: "request-1" });
  });

  it("gates Campus-West recipients to ACTIVE members with an accepted, concrete parent policy", async () => {
    const user = userEvent.setup();
    render(<DataPublicationWizard open onOpenChange={vi.fn()} projectId="campus-west" projectName="Campus West" takte={campusTakte} contractors={[
      activeContractor(),
      activeContractor({ id: "contractor-invited", orgId: "an-invited", name: "Eingeladener AN", assignmentStatus: "INVITED" }),
      activeContractor({ id: "contractor-pending", orgId: "an-pending", name: "Unbestätigter AN", projectAgreementStatus: "PENDING" }),
      activeContractor({ id: "contractor-other", orgId: "an-2", name: "Ausbaupartner", parentAgreement: policy("agreement-2", ["location"]) }),
    ]} />);

    expect(screen.getByText("Baupartner")).toBeInTheDocument();
    expect(screen.getByText("Ausbaupartner")).toBeInTheDocument();
    expect(screen.queryByText("Eingeladener AN")).not.toBeInTheDocument();
    expect(screen.queryByText("Unbestätigter AN")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Baupartner/ }));
    expect(screen.getByTestId("parent-agreement")).toHaveTextContent("agreement-1");
    await user.click(screen.getByRole("button", { name: /Ausbaupartner/ }));
    expect(screen.getByTestId("parent-agreement")).toHaveTextContent("agreement-2");
    expect(screen.getByTestId("parent-agreement")).toHaveTextContent("Zulässiger Feldumfang: location");
  });

  it("keeps inherited parent-policy fields read-only and resets to the Rahmentermine whitelist after a purpose change", async () => {
    const user = userEvent.setup();
    render(<DataPublicationWizard open onOpenChange={vi.fn()} projectId="campus-west" projectName="Campus West" contractors={[activeContractor()]} takte={campusTakte} />);

    await user.click(screen.getByRole("button", { name: /Baupartner/ }));
    await user.click(screen.getByRole("button", { name: /Weiter/ }));
    await user.selectOptions(screen.getByRole("combobox"), "LEISTUNGSKOORDINATION");
    await user.click(screen.getByRole("button", { name: /Weiter/ }));
    await user.click(screen.getAllByRole("checkbox")[0]);
    await user.click(screen.getByRole("button", { name: /Weiter/ }));
    expect(screen.getByText("Benötigte Ressourcen")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /Benötigte Ressourcen/ }));
    await user.click(screen.getByRole("button", { name: /Zurück/ }));
    await user.click(screen.getByRole("button", { name: /Zurück/ }));
    await user.selectOptions(screen.getByRole("combobox"), "RAHMENTERMINE");
    await user.click(screen.getByRole("button", { name: /Weiter/ }));
    await user.click(screen.getByRole("button", { name: /Weiter/ }));

    const context = screen.getByTestId("inherited-policy-context");
    expect(context).toHaveTextContent("schreibgeschützt");
    expect(screen.queryByRole("checkbox", { name: /Projektreferenz/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Benötigte Ressourcen/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Benötigte Ressourcen")).not.toBeInTheDocument();
    expect(screen.getByText("Geplanter Zeitraum")).toBeInTheDocument();
  });

  it("shows each policy delta and blocks a NOT_PERMITTED Campus-West release", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [
        { taktId: "L-101", deltaClass: "WITHIN_BASELINE", diff: { summary: ["Im Rahmen"] } },
        { taktId: "L-102", deltaClass: "REQUIRES_CONSENT", diff: { summary: ["Einwilligung erforderlich"] } },
        { taktId: "L-103", deltaClass: "NOT_PERMITTED", error: "Nicht von der Projektvereinbarung gedeckt" },
      ] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<DataPublicationWizard open onOpenChange={vi.fn()} projectId="campus-west" projectName="Campus West" contractors={[activeContractor()]} takte={campusTakte} />);

    await moveToReview(user, 3);
    expect(await screen.findByTestId("policy-preview")).toHaveTextContent("WITHIN_BASELINE");
    expect(screen.getByTestId("policy-preview")).toHaveTextContent("REQUIRES_CONSENT");
    expect(screen.getByTestId("policy-preview")).toHaveTextContent("NOT_PERMITTED");
    expect(screen.getByRole("button", { name: "Senden" })).toBeDisabled();
    expect(mocks.createBatch).not.toHaveBeenCalled();
  });

  it("reports L-101/L-102/L-103 partial sending and retries only the failed release", async () => {
    const user = userEvent.setup();
    let resolveRetry: (value: { requests: Array<{ id: string }> }) => void = () => undefined;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: campusTakte.map((takt) => ({ taktId: takt.id, deltaClass: "WITHIN_BASELINE" })) }),
    }));
    mocks.createBatch
      .mockResolvedValueOnce({ requests: [{ id: "request-101" }] })
      .mockRejectedValueOnce(new Error("L-102 nicht erreichbar"))
      .mockResolvedValueOnce({ requests: [{ id: "request-103" }] })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRetry = resolve; }));
    mocks.send.mockResolvedValue({ status: "DELIVERED" });
    render(<DataPublicationWizard open onOpenChange={vi.fn()} projectId="campus-west" projectName="Campus West" contractors={[activeContractor()]} takte={campusTakte} />);

    await moveToReview(user, 3);
    await user.click(screen.getByRole("button", { name: "Senden" }));
    const results = await screen.findByTestId("batch-send-results");
    expect(results).toHaveTextContent("Leistung L-101: gesendet");
    expect(results).toHaveTextContent("Leistung L-102: fehlgeschlagen – L-102 nicht erreichbar");
    expect(results).toHaveTextContent("Leistung L-103: gesendet");
    expect(mocks.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: "1 von 3 Leistungsfreigaben fehlgeschlagen", variant: "destructive" }));

    const retry = screen.getByRole("button", { name: /Fehlgeschlagene erneut senden/ });
    await user.click(retry);
    await user.click(screen.getByRole("button", { name: /Wird gesendet/ }));
    expect(mocks.createBatch).toHaveBeenCalledTimes(4);
    resolveRetry({ requests: [{ id: "request-102-retry" }] });
    await waitFor(() => expect(mocks.createBatch).toHaveBeenCalledTimes(4));
    expect(mocks.createBatch.mock.calls[3][0]).toEqual(expect.objectContaining({ data: expect.objectContaining({ taktId: "L-102" }) }));
    expect(mocks.toast).toHaveBeenLastCalledWith({ title: "Leistungen für AN freigegeben" });
  });
});