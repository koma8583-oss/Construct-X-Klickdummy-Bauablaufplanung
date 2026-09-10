import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaktRequestDetail } from "@workspace/api-client-react";
import i18n from "@/i18n";
import { GUDecisionPanel } from "../gu-decision-panel";

const { retryMutation } = vi.hoisted(() => ({
  retryMutation: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  useCreateGuDecision: () => ({ mutateAsync: vi.fn() }),
  useRetryGuDecisionDelivery: () => ({
    mutateAsync: retryMutation,
    isPending: false,
  }),
  getGetTaktRequestDetailQueryKey: (requestId: string) => ["takt-request-detail", requestId],
  getListTakteQueryKey: (projectId: string) => ["takte", projectId],
  getListTaktRequestsQueryKey: () => ["takt-requests"],
  getGetProjectQueryKey: (projectId: string) => ["project", projectId],
}));

const failedDeliveryDetail = {
  id: "request-privacy-test",
  guDecision: {
    decisionType: "CONFIRM_ACCEPTED",
    decidedAt: "2026-09-09T10:00:00.000Z",
    delivery: {
      status: "FAILED",
      attemptCount: 2,
      lastAttemptAt: "2026-09-09T10:05:00.000Z",
      deliveredAt: null,
      failureReason: "Transport failed for contractor RESOURCE-42 / resource-id-987",
    },
  },
  taktLifecycleStatus: null,
} as TaktRequestDetail;

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <GUDecisionPanel detail={failedDeliveryDetail} />
    </QueryClientProvider>,
  );
}

describe("GU decision delivery retry privacy", () => {
  afterEach(() => {
    cleanup();
    retryMutation.mockReset();
  });

  it.each([
    {
      locale: "en",
      safeMessage: "Retry failed. The decision is still saved; you can try delivery again.",
      failedStatus: "Delivery failed — contractor was not notified",
      retryAction: "Retry delivery",
    },
    {
      locale: "de",
      safeMessage:
        "Erneuter Zustellversuch fehlgeschlagen. Die Entscheidung ist weiterhin gespeichert; Sie können die Zustellung erneut versuchen.",
      failedStatus: "Zustellung fehlgeschlagen – NU wurde nicht benachrichtigt",
      retryAction: "Zustellung erneut versuchen",
    },
  ])(
    "renders the localized safe retry error without transport details in $locale",
    async ({ locale, safeMessage, failedStatus, retryAction }) => {
      await i18n.changeLanguage(locale);
      retryMutation.mockRejectedValueOnce(
        new Error("Transport failed for contractor RESOURCE-42 / resource-id-987"),
      );

      renderPanel();

      expect(screen.getByText(failedStatus)).toBeInTheDocument();
      const retryButton = screen.getByRole("button", { name: retryAction });
      await userEvent.click(retryButton);

      expect(await screen.findByRole("alert")).toHaveTextContent(safeMessage);
      expect(screen.getByText(failedStatus)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: retryAction })).toBeInTheDocument();
      expect(screen.queryByText(/RESOURCE-42|resource-id-987/)).not.toBeInTheDocument();
    },
  );
});