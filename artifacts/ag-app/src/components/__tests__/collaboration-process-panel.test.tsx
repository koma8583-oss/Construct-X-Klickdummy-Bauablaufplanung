import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataPublication, ProjectMembership } from "@workspace/api-client-react";
import { CollaborationProcessPanel } from "@/components/CollaborationProcessPanel";

function renderPanel(
  memberships: Array<{ id: string; anOrgId: string; status: ProjectMembership["status"] }>,
  publications: DataPublication[] = [],
) {
  const onReleaseData = vi.fn();
  render(
    <CollaborationProcessPanel
      memberships={memberships}
      publications={publications}
      getPartnerName={(anOrgId) => ({
        "an-invited": "Eingeladener Betrieb",
        "an-active": "Aktiver Betrieb",
      })[anOrgId] ?? anOrgId}
      onInvite={vi.fn()}
      onReleaseData={onReleaseData}
    />,
  );
  return onReleaseData;
}

function publication(
  id: string,
  status: DataPublication["status"],
  recipientStatuses: Record<string, "OFFERED" | "ACCEPTED" | "REJECTED" | "REVOKED" | "EXPIRED">,
  createdAt = "2026-09-01T10:00:00.000Z",
) {
  return {
    id,
    createdAt,
    updatedAt: createdAt,
    status,
    recipients: Object.entries(recipientStatuses).map(([anOrgId, recipientStatus]) => ({
      anOrgId,
      status: recipientStatus,
    })),
  } as DataPublication;
}

function expectStepState(partner: HTMLElement, number: number, state: "complete" | "current" | "locked" | "rejected") {
  const expectedClass = {
    complete: "border-emerald-500/30",
    current: "border-primary/30",
    locked: "border-border",
    rejected: "border-destructive/30",
  }[state];
  expect(within(partner).getByTestId(`collaboration-process-step-${number}`)).toHaveClass(expectedClass);
}

describe("CollaborationProcessPanel", () => {
  afterEach(() => cleanup());

  it("keeps data release and access locked before membership is active", () => {
    renderPanel([{ id: "membership-1", anOrgId: "an-invited", status: "INVITED" }]);

    const partner = screen.getByTestId("collaboration-process-partner-an-invited");
    expect(within(partner).getByText("Eingeladener Betrieb · Datenraumprozess")).toBeInTheDocument();
    expect(within(partner).getByText("Gesendet")).toBeInTheDocument();
    expect(within(partner).getByText("Warten auf Annahme durch AN")).toBeInTheDocument();
    expectStepState(partner, 1, "complete");
    expectStepState(partner, 2, "current");
    expectStepState(partner, 3, "locked");
    expectStepState(partner, 4, "locked");
    expect(within(partner).getAllByText("Gesperrt · erst nach aktiver Projektmitgliedschaft")).toHaveLength(1);
    expect(within(partner).getByText("Gesperrt · erst nach Datenfreigabe")).toBeInTheDocument();
    expect(within(partner).queryByRole("button", { name: "Daten für AN freigeben" })).not.toBeInTheDocument();
  });

  it("offers release only to active members without a publication", () => {
    const onReleaseData = renderPanel([{ id: "membership-2", anOrgId: "an-active", status: "ACTIVE" }]);

    const partner = screen.getByTestId("collaboration-process-partner-an-active");
    expect(within(partner).getByText("Aktive Projektmitgliedschaft")).toBeInTheDocument();
    expect(within(partner).getByRole("button", { name: "Daten für AN freigeben" })).toBeInTheDocument();
    within(partner).getByRole("button", { name: "Daten für AN freigeben" }).click();
    expect(onReleaseData).toHaveBeenCalledWith("an-active", undefined);
    expectStepState(partner, 3, "current");
    expectStepState(partner, 4, "locked");
  });

  it.each([
    ["OFFERED", "Datenangebot wartet auf Prüfung/Akzeptanz durch AN", "current"],
    ["ACCEPTED", "Datenzugriff aktiv · abgeschlossen", "complete"],
    ["REJECTED", "Datenangebot abgelehnt", "rejected"],
    ["REVOKED", "Datenzugriff widerrufen", "rejected"],
    ["EXPIRED", "Datenfreigabe abgelaufen", "rejected"],
  ] as const)("renders published recipient status %s explicitly", (status, detail, stepState) => {
    renderPanel(
      [{ id: "membership-3", anOrgId: "an-active", status: "ACTIVE" }],
      [publication("publication-1", "PUBLISHED", { "an-active": status })],
    );

    const partner = screen.getByTestId("collaboration-process-partner-an-active");
    expect(within(partner).getByText("Datenfreigabe veröffentlicht")).toBeInTheDocument();
    expect(within(partner).getByText(detail)).toBeInTheDocument();
    expectStepState(partner, 3, "complete");
    expectStepState(partner, 4, stepState);
    expect(within(partner).queryByRole("button", { name: "Daten für AN freigeben" })).not.toBeInTheDocument();
  });

  it("keeps a published accepted release effective when a newer draft exists", () => {
    renderPanel(
      [{ id: "membership-4", anOrgId: "an-active", status: "ACTIVE" }],
      [
        publication("published-accepted", "PUBLISHED", { "an-active": "ACCEPTED" }, "2026-09-01T10:00:00.000Z"),
        publication("new-draft", "DRAFT", { "an-active": "OFFERED" }, "2026-09-02T10:00:00.000Z"),
      ],
    );

    const partner = screen.getByTestId("collaboration-process-partner-an-active");
    expect(within(partner).getByText("Datenfreigabe veröffentlicht · neuer Entwurf vorhanden")).toBeInTheDocument();
    expect(within(partner).getByText("Datenzugriff aktiv · abgeschlossen")).toBeInTheDocument();
    expectStepState(partner, 3, "complete");
    expectStepState(partner, 4, "complete");
  });

  it("evaluates multiple recipients independently", () => {
    renderPanel(
      [
        { id: "membership-offered", anOrgId: "an-offered", status: "ACTIVE" },
        { id: "membership-accepted", anOrgId: "an-accepted", status: "ACTIVE" },
      ],
      [publication("publication-multi", "PUBLISHED", {
        "an-offered": "OFFERED",
        "an-accepted": "ACCEPTED",
      })],
    );

    const offered = screen.getByTestId("collaboration-process-partner-an-offered");
    const accepted = screen.getByTestId("collaboration-process-partner-an-accepted");
    expect(within(offered).getByText("Datenangebot wartet auf Prüfung/Akzeptanz durch AN")).toBeInTheDocument();
    expect(within(accepted).getByText("Datenzugriff aktiv · abgeschlossen")).toBeInTheDocument();
    expectStepState(offered, 4, "current");
    expectStepState(accepted, 4, "complete");
  });

  it("uses an existing draft for the retry action", () => {
    const onReleaseData = renderPanel(
      [{ id: "membership-draft", anOrgId: "an-active", status: "ACTIVE" }],
      [publication("draft-1", "DRAFT", { "an-active": "OFFERED" })],
    );

    const partner = screen.getByTestId("collaboration-process-partner-an-active");
    within(partner).getByRole("button", { name: "Entwurf veröffentlichen" }).click();
    expect(onReleaseData).toHaveBeenCalledWith("an-active", "draft-1");
  });
});