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

describe("CollaborationProcessPanel", () => {
  afterEach(() => cleanup());

  it("keeps data release and access locked before membership is active", () => {
    renderPanel([{ id: "membership-1", anOrgId: "an-invited", status: "INVITED" }]);

    const partner = screen.getByTestId("collaboration-process-partner-an-invited");
    expect(within(partner).getByText("Eingeladener Betrieb · Datenraumprozess")).toBeInTheDocument();
    expect(within(partner).getByText("Warten auf Annahme durch AN")).toBeInTheDocument();
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
    expect(onReleaseData).toHaveBeenCalledWith("an-active");
  });

  it("shows accepted access per recipient when the publication is published", () => {
    renderPanel(
      [{ id: "membership-3", anOrgId: "an-active", status: "ACTIVE" }],
      [{
        id: "publication-1",
        createdAt: "2026-09-01T10:00:00.000Z",
        status: "PUBLISHED",
        recipients: [{ anOrgId: "an-active", status: "ACCEPTED" }],
      } as DataPublication],
    );

    const partner = screen.getByTestId("collaboration-process-partner-an-active");
    expect(within(partner).getByText("Datenfreigabe veröffentlicht")).toBeInTheDocument();
    expect(within(partner).getByText("Datenzugriff akzeptiert")).toBeInTheDocument();
    expect(within(partner).queryByRole("button", { name: "Daten für AN freigeben" })).not.toBeInTheDocument();
  });
});