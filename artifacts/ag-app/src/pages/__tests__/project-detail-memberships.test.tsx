import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MembershipFixture = {
  id: string;
  anOrgId: string;
  status: string;
  invitationDelivery?: {
    messageId: string;
    messageType: string;
    status: string;
    attemptCount: number;
    failureReason?: string;
    createdAt: string;
  };
  responseDelivery?: {
    messageId: string;
    messageType: string;
    status: string;
    attemptCount: number;
    failureReason?: string;
    createdAt: string;
  };
};

const membershipFixtures: MembershipFixture[] = [
  {
    id: "membership-invited",
    anOrgId: "an-invited",
    status: "INVITED",
    invitationDelivery: {
      messageId: "project-invitation-invited",
      messageType: "PROJECT_INVITATION",
      status: "FAILED",
      attemptCount: 2,
      failureReason: "Connector nicht erreichbar",
      createdAt: "2026-08-26T08:00:00.000Z",
    },
  },
  {
    id: "membership-active",
    anOrgId: "an-active",
    status: "ACTIVE",
    responseDelivery: {
      messageId: "project-invitation-response-active-ACTIVE",
      messageType: "PROJECT_INVITATION_RESPONSE",
      status: "PENDING",
      attemptCount: 1,
      createdAt: "2026-08-26T08:00:00.000Z",
    },
  },
  { id: "membership-revoked", anOrgId: "an-revoked", status: "REVOKED" },
  { id: "membership-rejected", anOrgId: "an-rejected", status: "REJECTED" },
];

let memberships = [...membershipFixtures];
let updateMemberships: React.Dispatch<React.SetStateAction<MembershipFixture[]>> | undefined;
let retryDelivery: ReturnType<typeof vi.fn>;
let retryShouldFail = false;
let toastMock: ReturnType<typeof vi.fn>;

vi.mock("wouter", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useLocation: () => ["/projects/project-1", vi.fn()],
  useParams: () => ({ projectId: "project-1" }),
}));

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ user: { roles: [] }, hasRole: () => true }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/components/DataPublicationWizard", () => ({
  DataPublicationWizard: () => null,
}));

vi.mock("@workspace/api-client-react", async () => {
  const actual = await vi.importActual<typeof import("@workspace/api-client-react")>(
    "@workspace/api-client-react",
  );
  const queryResult = (data: unknown = []) => ({ data, isLoading: false });
  const mutation = (onMutate?: (variables: any) => void) => ({
    isPending: false,
    mutate: vi.fn((variables: any, options?: { onSuccess?: () => void }) => {
      onMutate?.(variables);
      options?.onSuccess?.();
    }),
  });
  return {
    ...actual,
    useGetAgProjectOverview: () => queryResult({
      project: {
        id: "project-1",
        projectName: "Testprojekt",
        status: "ACTIVE",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
      },
      coordination: {
        pendingProposals: 0,
        numberOfTakts: 0,
        confirmedTakts: 0,
        taktsInCoordination: 0,
        openRequests: 0,
        overdueRequests: 0,
        revisionRounds: 0,
      },
    }),
    useListTakte: () => queryResult([]),
    useListProjectContractors: () => queryResult([]),
    useListProjectMemberships: () => {
      const [current, setCurrent] = React.useState(memberships);
      updateMemberships = setCurrent;
      return queryResult(current);
    },
    useRetryProjectInvitationDelivery: () => ({
      isPending: false,
      mutate: retryDelivery,
    }),
    useListOrganizations: () => queryResult([
      { id: "an-invited", name: "Eingeladener Betrieb", contactEmail: "invited@example.com" },
      { id: "an-active", name: "Aktiver Betrieb", contactEmail: "active@example.com" },
      { id: "an-revoked", name: "Widerrufener Betrieb", contactEmail: "revoked@example.com" },
      { id: "an-rejected", name: "Abgelehnter Betrieb", contactEmail: "rejected@example.com" },
      { id: "an-new", name: "Neuer Betrieb", contactEmail: "new@example.com" },
    ]),
    useListTaktRequests: () => queryResult([]),
    useListTaktDependencies: () => queryResult([]),
    useListProjectSubcontractors: () => queryResult([]),
    useGetProject: () => queryResult({}),
    useGetProjectCalendar: () => queryResult(undefined),
    useGetProjectDataPublications: () => queryResult([]),
    useCreateTakt: () => mutation(),
    useUpdateTakt: () => mutation(),
    useDeleteTakt: () => mutation(),
    useCreateTaktRequestWithSnapshot: () => mutation(),
    useSendTaktRequest: () => mutation(),
    useCreateGuDecision: () => mutation(),
    useCreateTaktDependency: () => mutation(),
    useCreateTaktDependencySkipReschedule: () => mutation(),
    useDeleteTaktDependency: () => mutation(),
    useUpdateProject: () => mutation(),
    useCreateProjectSubcontractor: () => mutation(),
    useUpdateProjectSubcontractor: () => mutation(),
    useDeactivateProjectSubcontractor: () => mutation(),
    useUpdateProjectCalendar: () => mutation(),
    useSuspendDataPublication: () => mutation(),
    useWithdrawDataPublication: () => mutation(),
    useInviteProjectParticipant: () => mutation(({ data }: { data: { anOrgId: string } }) => {
      const invited = {
        id: `membership-${data.anOrgId}`,
        anOrgId: data.anOrgId,
        status: "INVITED",
      };
      memberships = [...memberships, invited];
      updateMemberships?.(memberships);
    }),
    useRevokeProjectMembership: () => mutation(({ id }: { id: string }) => {
      memberships = memberships.map((membership) =>
        membership.id === id ? { ...membership, status: "REVOKED" } : membership,
      );
      updateMemberships?.(memberships);
    }),
    getGetAgProjectsOverviewQueryKey: () => [],
    getGetProjectQueryKey: () => [],
    getGetProjectCalendarQueryKey: () => [],
    getListTakteQueryKey: () => [],
    getListProjectContractorsQueryKey: () => [],
    getListProjectMembershipsQueryKey: () => [],
    getListOrganizationsQueryKey: () => [],
    getListTaktRequestsQueryKey: () => [],
    getListTaktDependenciesQueryKey: () => [],
    getListProjectSubcontractorsQueryKey: () => [],
    getGetTaktRequestDetailQueryKey: () => [],
  };
});


import ProjectDetail from "../project-detail";

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectDetail />
    </QueryClientProvider>,
  );
}

describe("project participant directory membership lifecycle", () => {
  beforeEach(() => {
    memberships = [...membershipFixtures];
    updateMemberships = undefined;
    retryShouldFail = false;
    toastMock = vi.fn();
    retryDelivery = vi.fn(({ messageId }: { messageId: string }, options?: {
      onSuccess?: (result: { status: string }) => void;
      onError?: (error: Error) => void;
      onSettled?: () => void;
    }) => {
      if (retryShouldFail) {
        options?.onError?.(new Error("Die Zustellung wurde nach fünf Versuchen aufgegeben."));
      } else {
        memberships = memberships.map((membership) => {
          if (membership.invitationDelivery?.messageId === messageId) {
            return {
              ...membership,
              invitationDelivery: { ...membership.invitationDelivery, status: "DELIVERED" },
            };
          }
          if (membership.responseDelivery?.messageId === messageId) {
            return {
              ...membership,
              responseDelivery: { ...membership.responseDelivery, status: "DELIVERED" },
            };
          }
          return membership;
        });
        updateMemberships?.(memberships);
        options?.onSuccess?.({ status: "DELIVERED" });
      }
      options?.onSettled?.();
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify([
         { localOrgId: "an-invited", organizationName: "Eingeladener Betrieb", participantId: "local:an-invited", identityStatus: "VERIFIED", connectorStatus: "UNKNOWN", selectable: true },
         { localOrgId: "an-active", organizationName: "Aktiver Betrieb", participantId: "local:an-active", identityStatus: "VERIFIED", connectorStatus: "UNKNOWN", selectable: true },
         { localOrgId: "an-revoked", organizationName: "Widerrufener Betrieb", participantId: "local:an-revoked", identityStatus: "VERIFIED", connectorStatus: "UNKNOWN", selectable: true },
         { localOrgId: "an-rejected", organizationName: "Abgelehnter Betrieb", participantId: "local:an-rejected", identityStatus: "VERIFIED", connectorStatus: "UNKNOWN", selectable: true },
         { localOrgId: "an-new", organizationName: "Neuer Betrieb", participantId: "local:an-new", identityStatus: "VERIFIED", connectorStatus: "UNKNOWN", selectable: true },
      ]), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("renders the German label for every membership state", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /Projektpartner/ }));

    const rowFor = async (name: string) =>
      (await screen.findByText(name)).closest("div.rounded-lg") as HTMLElement;
    expect(within(await rowFor("Eingeladener Betrieb")).getByText("Einladung ausstehend")).toBeInTheDocument();
    expect(within(await rowFor("Aktiver Betrieb")).getByText("Aktiv")).toBeInTheDocument();
    expect(within(await rowFor("Widerrufener Betrieb")).getByText("Widerrufen")).toBeInTheDocument();
    expect(within(await rowFor("Abgelehnter Betrieb")).getByText("Abgelehnt")).toBeInTheDocument();
  });

  it("does not offer an unassigned participant in the project partner dialog", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /Projektpartner/ }));

    expect(screen.queryByText("Neuer Betrieb")).not.toBeInTheDocument();
  });

  it("refreshes invited and active rows to revoked after confirmation", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /Projektpartner/ }));

    const invitedRow = (await screen.findByText("Eingeladener Betrieb")).closest("div.rounded-lg");
    await user.click(within(invitedRow as HTMLElement).getByRole("button", { name: "Widerrufen" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Widerrufen" }));
    await waitFor(() => {
      expect(within(invitedRow as HTMLElement).getByText("Widerrufen")).toBeInTheDocument();
    });

    const activeRow = (await screen.findByText("Aktiver Betrieb")).closest("div.rounded-lg");
    await user.click(within(activeRow as HTMLElement).getByRole("button", { name: "Widerrufen" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Widerrufen" }));
    await waitFor(() => {
      expect(within(activeRow as HTMLElement).getByText("Widerrufen")).toBeInTheDocument();
    });
  });

  it("shows failed and pending deliveries and retries the selected delivery", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /Projektpartner/ }));

    expect(screen.getByText(/Einladung: Zustellung fehlgeschlagen/)).toBeInTheDocument();
    expect(screen.getByText(/Antwort: Zustellung ausstehend/)).toBeInTheDocument();

    const invitedRow = (await screen.findByText("Eingeladener Betrieb")).closest("div.rounded-lg");
    await user.click(within(invitedRow as HTMLElement).getByRole("button", { name: "Erneut senden" }));

    expect(retryDelivery).toHaveBeenCalledWith(
      { messageId: "project-invitation-invited" },
      expect.any(Object),
    );
    await waitFor(() => {
      expect(screen.queryByText(/Einladung: Zustellung fehlgeschlagen/)).not.toBeInTheDocument();
    });
  });

  it("surfaces the backend retry error instead of reporting success", async () => {
    retryShouldFail = true;
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /Projektpartner/ }));

    const invitedRow = (await screen.findByText("Eingeladener Betrieb")).closest("div.rounded-lg");
    await user.click(within(invitedRow as HTMLElement).getByRole("button", { name: "Erneut senden" }));

    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: "Zustellung konnte nicht wiederholt werden",
      description: "Die Zustellung wurde nach fünf Versuchen aufgegeben.",
      variant: "destructive",
    }));
    expect(toastMock).not.toHaveBeenCalledWith(expect.objectContaining({
      title: "Zustellung erneut angestoßen",
    }));
  });
});