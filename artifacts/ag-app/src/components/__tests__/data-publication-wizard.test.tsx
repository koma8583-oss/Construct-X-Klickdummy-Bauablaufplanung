import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataPublicationWizard } from "@/components/DataPublicationWizard";

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
    await user.click(screen.getByRole("checkbox"));
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
});