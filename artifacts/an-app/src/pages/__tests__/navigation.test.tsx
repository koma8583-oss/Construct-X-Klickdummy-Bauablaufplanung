import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import App from "../../App";
import { Layout } from "../../components/layout";
import LocalProjectsPage from "../local-projects";
import { useAuth } from "../../contexts/auth";

vi.mock("../../contexts/auth", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: vi.fn(),
}));

const authenticatedAnUser = {
  id: "an-user-1",
  name: "AN Test",
  email: "an@example.com",
  preferredLanguage: "de",
  orgId: "an-org-1",
  orgName: "AN Testorganisation",
  orgType: "AN" as const,
  hubAdmin: false,
  roles: ["AN_ADMIN" as const],
};

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function renderLocalProjects() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <Router base="">
        <LocalProjectsPage />
      </Router>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setAuthTokenGetter(null);
  window.history.pushState({}, "", "/");
});

beforeEach(() => {
  vi.mocked(useAuth).mockReturnValue({
    user: authenticatedAnUser,
    isLoading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    hasRole: vi.fn(() => true),
  });
});

describe("AN-Navigation", () => {
  it("zeigt keinen eigenständigen Ressourcenbelegungs-Eintrag in der Sidebar", () => {
    render(
      <Router base="/">
        <Layout>
          <div>Inhalt</div>
        </Layout>
      </Router>,
    );

    expect(screen.getByRole("link", { name: "Interne Projekte" })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Ressourcenbelegungen" }),
    ).not.toBeInTheDocument();
  });

  it("verlinkt Ressourcenbelegungen aus den Internen Projekten kontextuell", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("/local-projects")) {
          return jsonResponse({ items: [], total: 0, limit: 100, offset: 0 });
        }
        return jsonResponse({});
      }),
    );

    renderLocalProjects();

    expect(
      await screen.findByRole("link", { name: "Ressourcenbelegungen" }),
    ).toHaveAttribute("href", "/resource-bookings");
  });

  it("rendert die bestehende Ressourcenbelegungen-Route bei direktem Zugriff", async () => {
    window.history.pushState({}, "", "/resource-bookings");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/resource-bookings")) {
          return jsonResponse({ items: [], total: 0, limit: 100, offset: 0 });
        }
        if (url.includes("/resource-types") || url.includes("/resources")) {
          return jsonResponse({ items: [], total: 0 });
        }
        if (url.includes("/local-projects")) {
          return jsonResponse({ items: [], total: 0, limit: 100, offset: 0 });
        }
        return jsonResponse({});
      }),
    );

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Ressourcenbelegungen" }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/resource-bookings");
  });
});