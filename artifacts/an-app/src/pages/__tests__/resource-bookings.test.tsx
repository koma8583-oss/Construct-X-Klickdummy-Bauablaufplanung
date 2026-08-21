import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ResourceBookings from "../resource-bookings";
import { setAuthTokenGetter, type NuResourceBooking, type NuResourceBookingCreate } from "@workspace/api-client-react";

vi.mock("@/components/date-picker", () => ({
  DatePicker: ({ value, onChange }: { value?: string; onChange: (value: string) => void }) => (
    <input
      data-testid="date-picker"
      type="date"
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

const RESOURCE_TYPE_ID = "resource-type-1";
const BOOKING_ID = "booking-type-1";

const booking: NuResourceBooking = {
  id: BOOKING_ID,
  nuOrgId: "nu-org-1",
  resourceId: null,
  resourceTypeId: RESOURCE_TYPE_ID,
  quantity: 3,
  localProjectId: null,
  sourceType: "MANUAL_BLOCK",
  sourceReferenceId: null,
  startAt: "2026-09-15T00:00:00.000Z",
  endAt: "2026-09-15T23:59:59.000Z",
  utilizationPercent: 100,
  status: "TENTATIVE",
  note: null,
  createdAt: "2026-08-21T00:00:00.000Z",
  updatedAt: "2026-08-21T00:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ResourceBookings />
    </QueryClientProvider>,
  );
}

function resourceTypeTrigger(): HTMLElement {
  const trigger = document.querySelector<HTMLElement>('button[aria-label="Ressourcentyp"]');
  if (!trigger) throw new Error("Ressourcentyp selector is not rendered");
  return trigger;
}

describe("authenticated AN resource type bookings", () => {
  let requests: Array<{ url: string; init?: RequestInit }>;
  let created = false;

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    requests = [];
    created = false;
    Object.assign(HTMLElement.prototype, {
      hasPointerCapture: () => false,
      setPointerCapture: () => undefined,
      releasePointerCapture: () => undefined,
      scrollIntoView: () => undefined,
    });
    setAuthTokenGetter(() => "an-smoke-test-token");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });

      if (url.includes("/resource-bookings")) {
        if (init?.method === "POST") {
          created = true;
          return jsonResponse(booking, 201);
        }
        return jsonResponse({ items: created ? [booking] : [], total: created ? 1 : 0, limit: 100, offset: 0 });
      }
      if (url.includes("/resource-types")) {
        return jsonResponse({ items: [{ id: RESOURCE_TYPE_ID, name: "Maurer" }], total: 1 });
      }
      if (url.includes("/resources")) return jsonResponse([]);
      if (url.includes("/local-projects")) return jsonResponse({ items: [], total: 0 });
      return jsonResponse({});
    }));
  });

  it("creates an authenticated capacity booking and renders its quantity in the list", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Neue Belegung" }));
    await user.click(resourceTypeTrigger());
    await user.click(await screen.findByRole("option", { name: "Maurer" }));

    const quantity = screen.getAllByRole("spinbutton")[0];
    await user.clear(quantity);
    await user.type(quantity, "3");

    const dates = screen.getAllByTestId("date-picker");
    fireEvent.change(dates.at(-2)!, { target: { value: "2026-09-15" } });
    fireEvent.change(dates.at(-1)!, { target: { value: "2026-09-15" } });
    await user.click(screen.getByRole("button", { name: "Anlegen" }));

    await waitFor(() => {
      expect(screen.getByText("Maurer (3 Einheiten)")).toBeInTheDocument();
    });

    const createRequest = requests.find(({ init }) => init?.method === "POST");
    expect(new Headers(createRequest?.init?.headers).get("authorization")).toBe("Bearer an-smoke-test-token");
    const payload = JSON.parse(String(createRequest?.init?.body)) as NuResourceBookingCreate;
    expect(payload).toMatchObject({
      resourceTypeId: RESOURCE_TYPE_ID,
      quantity: 3,
      sourceType: "MANUAL_BLOCK",
    });
  });

  it.each(["", "0", "-2"])("does not submit an empty or non-positive quantity (%s)", async (value) => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Neue Belegung" }));
    await user.click(resourceTypeTrigger());
    await user.click(await screen.findByRole("option", { name: "Maurer" }));

    const quantity = screen.getAllByRole("spinbutton")[0];
    await user.clear(quantity);
    if (value) await user.type(quantity, value);

    expect(screen.getByRole("button", { name: "Anlegen" })).toBeDisabled();
    expect(requests.filter(({ init }) => init?.method === "POST")).toHaveLength(0);
  });
});