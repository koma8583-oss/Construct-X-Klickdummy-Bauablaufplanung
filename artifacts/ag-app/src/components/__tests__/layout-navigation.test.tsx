import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({
    user: { name: "AG Test", email: "ag@example.com" },
    logout: vi.fn(),
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      "nav.dashboard": "Übersicht",
      "nav.projects": "Projekte",
      "nav.datenraum": "Datenraum",
      "nav.settings": "Einstellungen",
      "nav.logout": "Abmelden",
    }[key] ?? key),
  }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetAgProjectsOverview: () => ({ data: [] }),
}));

vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href?: string }) => <a href={href}>{children}</a>,
  useLocation: () => ["/projects", vi.fn()],
}));

import { Layout } from "../layout";

describe("AG navigation", () => {
  it("does not expose a global subcontractor or participant directory page", () => {
    render(<Layout><main>Projektinhalt</main></Layout>);

    expect(screen.queryByRole("link", { name: "Nachunternehmer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Datenraumteilnehmer" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Projekte" })).toBeInTheDocument();
  });
});