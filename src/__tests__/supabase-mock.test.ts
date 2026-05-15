import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SupabaseMock,
  buildMockSession,
} from "../supabase-mock.js";
import type { Page, Route, Request } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helpers to create minimal Playwright Page / Route mocks
// ---------------------------------------------------------------------------

type UrlPredicate = (url: URL) => boolean;
type RouteHandler = (route: Route) => Promise<void> | void;

interface FakeRoute {
  request: () => Request;
  fulfill: ReturnType<typeof vi.fn>;
  continue: ReturnType<typeof vi.fn>;
  fallback: ReturnType<typeof vi.fn>;
}

function makeFakeRoute(method: string, rawUrl: string): FakeRoute {
  return {
    request: () =>
      ({
        method: () => method,
        url: () => rawUrl,
      } as unknown as Request),
    fulfill: vi.fn().mockResolvedValue(undefined),
    continue: vi.fn().mockResolvedValue(undefined),
    fallback: vi.fn().mockResolvedValue(undefined),
  };
}

interface CapturedEntry {
  predicate: UrlPredicate;
  handler: RouteHandler;
}

function makeFakePage(): {
  page: Page;
  capturedEntries: CapturedEntry[];
  setUrl: (url: string) => void;
} {
  const capturedEntries: CapturedEntry[] = [];
  let currentUrl = "about:blank";

  const page = {
    route: vi.fn(async (predicate: UrlPredicate, handler: RouteHandler) => {
      capturedEntries.push({ predicate, handler });
    }),
    unroute: vi.fn().mockResolvedValue(undefined),
    addInitScript: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(undefined),
    url: vi.fn(() => currentUrl),
  } as unknown as Page;

  return {
    page,
    capturedEntries,
    setUrl: (url: string) => {
      currentUrl = url;
    },
  };
}

/** Returns true if the registered URL predicate matches the given URL string. */
function urlMatches(entry: CapturedEntry, url: string): boolean {
  return entry.predicate(new URL(url));
}

const SUPABASE_URL = "https://xyz.supabase.co";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SupabaseMock", () => {
  let page: Page;
  let capturedEntries: CapturedEntry[];
  let mock: SupabaseMock;
  let setUrl: (url: string) => void;

  beforeEach(() => {
    const fake = makeFakePage();
    page = fake.page;
    capturedEntries = fake.capturedEntries;
    setUrl = fake.setUrl;
    mock = new SupabaseMock(page, { url: SUPABASE_URL });
  });

  // -------------------------------------------------------------------------
  // Database
  // -------------------------------------------------------------------------

  describe("database()", () => {
    it("registers a predicate that matches the table endpoint", async () => {
      const handle = await mock.database("todos").select({ body: [] });
      expect(capturedEntries).toHaveLength(1);
      expect(page.route).toHaveBeenCalledOnce();

      // The predicate should match the table URL
      expect(urlMatches(capturedEntries[0]!, `${SUPABASE_URL}/rest/v1/todos`)).toBe(true);
      // Should not match a different table
      expect(urlMatches(capturedEntries[0]!, `${SUPABASE_URL}/rest/v1/users`)).toBe(false);

      // Dispose removes the route
      await handle.dispose();
      expect(page.unroute).toHaveBeenCalledOnce();
    });

    it("does not match unrelated tables that share a prefix while still allowing query strings", async () => {
      await mock.database("todos").select({ body: [] });

      expect(urlMatches(capturedEntries[0]!, `${SUPABASE_URL}/rest/v1/todos?id=eq.1`)).toBe(true);
      expect(urlMatches(capturedEntries[0]!, `${SUPABASE_URL}/rest/v1/todos_archive`)).toBe(
        false
      );
      expect(urlMatches(capturedEntries[0]!, `${SUPABASE_URL}/rest/v1/todos2`)).toBe(false);
    });

    it("fulfills a matching GET request with the provided body", async () => {
      const body = [{ id: 1, title: "Buy milk" }];
      await mock.database("todos").select({ body });

      const route = makeFakeRoute("GET", `${SUPABASE_URL}/rest/v1/todos`);
      await capturedEntries[0]!.handler(route as unknown as Route);

      expect(route.fulfill).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 200,
          body: JSON.stringify(body),
        })
      );
      expect(route.continue).not.toHaveBeenCalled();
    });

    it("calls route.fallback() when the HTTP method does not match (POST on a select route)", async () => {
      await mock.database("todos").select();

      // A POST to the same URL should NOT be intercepted by the GET handler
      const route = makeFakeRoute("POST", `${SUPABASE_URL}/rest/v1/todos`);
      await capturedEntries[0]!.handler(route as unknown as Route);

      expect(route.fallback).toHaveBeenCalledOnce();
      expect(route.continue).not.toHaveBeenCalled();
      expect(route.fulfill).not.toHaveBeenCalled();
    });

    it("allows sibling same-endpoint method mocks to run when registration order differs", async () => {
      await mock.database("todos").insert({ body: { id: 1 } });
      await mock.database("todos").select({ body: [{ id: 1 }] });

      const route = makeFakeRoute("POST", `${SUPABASE_URL}/rest/v1/todos`);
      await capturedEntries[1]!.handler(route as unknown as Route);
      await capturedEntries[0]!.handler(route as unknown as Route);

      expect(route.fallback).toHaveBeenCalledOnce();
      expect(route.fulfill).toHaveBeenCalledOnce();
      expect(route.fulfill).toHaveBeenCalledWith(
        expect.objectContaining({ body: JSON.stringify({ id: 1 }) })
      );
    });

    it("registers a POST route for insert", async () => {
      await mock.database("users").insert({ body: { id: 42 } });
      const route = makeFakeRoute("POST", `${SUPABASE_URL}/rest/v1/users`);
      await capturedEntries[0]!.handler(route as unknown as Route);
      expect(route.fulfill).toHaveBeenCalledWith(
        expect.objectContaining({ status: 200, body: JSON.stringify({ id: 42 }) })
      );
    });

    it("registers a PATCH route for update", async () => {
      await mock.database("users").update({ body: { updated: true } });
      const route = makeFakeRoute("PATCH", `${SUPABASE_URL}/rest/v1/users`);
      await capturedEntries[0]!.handler(route as unknown as Route);
      expect(route.fulfill).toHaveBeenCalledOnce();
    });

    it("registers a DELETE route for delete", async () => {
      await mock.database("users").delete({ status: 204 });
      const route = makeFakeRoute("DELETE", `${SUPABASE_URL}/rest/v1/users`);
      await capturedEntries[0]!.handler(route as unknown as Route);
      expect(route.fulfill).toHaveBeenCalledWith(
        expect.objectContaining({ status: 204 })
      );
    });

    it("defaults body to [] for select when no body is provided", async () => {
      await mock.database("items").select();
      const route = makeFakeRoute("GET", `${SUPABASE_URL}/rest/v1/items`);
      await capturedEntries[0]!.handler(route as unknown as Route);
      expect(route.fulfill).toHaveBeenCalledWith(
        expect.objectContaining({ body: "[]" })
      );
    });
  });

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  describe("auth", () => {
    it("registers a predicate for signInWithPassword matching the token endpoint with password grant", async () => {
      await mock.auth.signInWithPassword({
        body: { access_token: "tok", user: { id: "u1" } },
      });
      expect(capturedEntries).toHaveLength(1);
      expect(
        urlMatches(
          capturedEntries[0]!,
          `${SUPABASE_URL}/auth/v1/token?grant_type=password`
        )
      ).toBe(true);
      // Should NOT match refresh_token grant
      expect(
        urlMatches(
          capturedEntries[0]!,
          `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`
        )
      ).toBe(false);
    });

    it("fulfills signInWithPassword POST requests", async () => {
      const responseBody = { access_token: "abc", user: { id: "u1" } };
      await mock.auth.signInWithPassword({ body: responseBody });
      const route = makeFakeRoute(
        "POST",
        `${SUPABASE_URL}/auth/v1/token?grant_type=password`
      );
      await capturedEntries[0]!.handler(route as unknown as Route);
      expect(route.fulfill).toHaveBeenCalledWith(
        expect.objectContaining({ body: JSON.stringify(responseBody) })
      );
    });

    it("registers a predicate for signUp", async () => {
      await mock.auth.signUp();
      expect(
        urlMatches(capturedEntries[0]!, `${SUPABASE_URL}/auth/v1/signup`)
      ).toBe(true);
    });

    it("registers a predicate for signOut", async () => {
      await mock.auth.signOut();
      expect(
        urlMatches(capturedEntries[0]!, `${SUPABASE_URL}/auth/v1/logout`)
      ).toBe(true);
    });

    it("registers a predicate for getUser and fulfills it", async () => {
      await mock.auth.getUser({ body: { id: "u1" } });
      expect(
        urlMatches(capturedEntries[0]!, `${SUPABASE_URL}/auth/v1/user`)
      ).toBe(true);
      const route = makeFakeRoute("GET", `${SUPABASE_URL}/auth/v1/user`);
      await capturedEntries[0]!.handler(route as unknown as Route);
      expect(route.fulfill).toHaveBeenCalledWith(
        expect.objectContaining({ body: JSON.stringify({ id: "u1" }) })
      );
    });

    it("registers a predicate for refreshToken matching the refresh_token grant", async () => {
      await mock.auth.refreshToken();
      expect(
        urlMatches(
          capturedEntries[0]!,
          `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`
        )
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Storage
  // -------------------------------------------------------------------------

  describe("storage()", () => {
    it("registers a predicate for list matching the list endpoint", async () => {
      await mock.storage("avatars").list({ body: [{ name: "photo.png" }] });
      expect(
        urlMatches(
          capturedEntries[0]!,
          `${SUPABASE_URL}/storage/v1/object/list/avatars`
        )
      ).toBe(true);
    });

    it("fulfills list requests", async () => {
      const files = [{ name: "a.png" }];
      await mock.storage("avatars").list({ body: files });
      const route = makeFakeRoute(
        "POST",
        `${SUPABASE_URL}/storage/v1/object/list/avatars`
      );
      await capturedEntries[0]!.handler(route as unknown as Route);
      expect(route.fulfill).toHaveBeenCalledWith(
        expect.objectContaining({ body: JSON.stringify(files) })
      );
    });

    it("registers a predicate for upload", async () => {
      await mock.storage("docs").upload();
      const route = makeFakeRoute(
        "POST",
        `${SUPABASE_URL}/storage/v1/object/docs`
      );
      await capturedEntries[0]!.handler(route as unknown as Route);
      expect(route.fulfill).toHaveBeenCalledOnce();
    });

    it("registers a predicate for download with path", async () => {
      await mock.storage("avatars").download("user/photo.png", { body: "binary" });
      expect(
        urlMatches(
          capturedEntries[0]!,
          `${SUPABASE_URL}/storage/v1/object/avatars/user/photo.png`
        )
      ).toBe(true);
    });

    it("registers a DELETE predicate for remove", async () => {
      await mock.storage("docs").remove({ status: 200 });
      const route = makeFakeRoute(
        "DELETE",
        `${SUPABASE_URL}/storage/v1/object/docs`
      );
      await capturedEntries[0]!.handler(route as unknown as Route);
      expect(route.fulfill).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // Custom status codes and headers
  // -------------------------------------------------------------------------

  describe("custom response options", () => {
    it("respects a custom HTTP status code", async () => {
      await mock.database("items").select({ status: 403, body: { error: "Forbidden" } });
      const route = makeFakeRoute("GET", `${SUPABASE_URL}/rest/v1/items`);
      await capturedEntries[0]!.handler(route as unknown as Route);
      expect(route.fulfill).toHaveBeenCalledWith(
        expect.objectContaining({ status: 403 })
      );
    });

    it("merges custom headers with default content-type", async () => {
      await mock.database("items").select({
        headers: { "x-custom": "value" },
      });
      const route = makeFakeRoute("GET", `${SUPABASE_URL}/rest/v1/items`);
      await capturedEntries[0]!.handler(route as unknown as Route);
      expect(route.fulfill).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            "content-type": "application/json",
            "x-custom": "value",
          }),
        })
      );
    });
  });

  // -------------------------------------------------------------------------
  // URL normalisation
  // -------------------------------------------------------------------------

  describe("URL normalisation", () => {
    it("strips a trailing slash from the base URL", async () => {
      const mockWithSlash = new SupabaseMock(page, {
        url: "https://xyz.supabase.co/",
      });
      await mockWithSlash.database("todos").select();
      expect(
        urlMatches(capturedEntries[0]!, "https://xyz.supabase.co/rest/v1/todos")
      ).toBe(true);
    });
  });

  describe("mockCurrentUser()", () => {
    it("registers the session installer for future page loads", async () => {
      await mock.mockCurrentUser("alice@example.com");

      expect(page.addInitScript).toHaveBeenCalledOnce();
      expect(page.addInitScript).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          sessionEmail: "alice@example.com",
          authCookieKeys: ["sb-xyz-auth-token"],
        })
      );
      expect(page.evaluate).not.toHaveBeenCalled();
    });

    it("applies the session immediately when the page is already loaded", async () => {
      setUrl("https://app.example.com/dashboard");

      await mock.mockCurrentUser("alice@example.com");

      expect(page.evaluate).toHaveBeenCalledOnce();
      expect(page.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          sessionEmail: "alice@example.com",
          authCookieKeys: ["sb-xyz-auth-token"],
        })
      );
    });
  });
});

// ---------------------------------------------------------------------------
// buildMockSession
// ---------------------------------------------------------------------------

describe("buildMockSession", () => {
  it("sets access_token and refresh_token from email", () => {
    const session = buildMockSession("alice@example.com");
    expect(session.access_token).toBe("mock-access-token:alice@example.com");
    expect(session.refresh_token).toBe("mock-refresh-token:alice@example.com");
  });

  it("sets token_type to bearer", () => {
    const session = buildMockSession("alice@example.com");
    expect(session.token_type).toBe("bearer");
  });

  it("sets expires_in to 3600", () => {
    const session = buildMockSession("alice@example.com");
    expect(session.expires_in).toBe(3600);
  });

  it("sets expires_at approximately one hour from now", () => {
    const before = Math.floor(Date.now() / 1000) + 3600;
    const session = buildMockSession("alice@example.com");
    const after = Math.floor(Date.now() / 1000) + 3600;
    expect(session.expires_at).toBeGreaterThanOrEqual(before);
    expect(session.expires_at).toBeLessThanOrEqual(after);
  });
});
