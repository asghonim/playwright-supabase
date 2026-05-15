import type { Page, Route } from "@playwright/test";
import type {
  SupabaseMockOptions,
  MockResponseOptions,
  RouteHandle,
  DatabaseMockBuilder,
  AuthMockBuilder,
  StorageMockBuilder,
} from "./types.js";

const DEFAULT_HEADERS: Record<string, string> = {
  "content-type": "application/json",
};

interface AuthSpySeedPayload {
  /**
   * Email used to build the mock session.
   * - `undefined`: leave browser auth state unchanged.
   * - `null`: clear the mocked auth session.
   */
  sessionEmail?: string | null;
  /**
   * Supabase auth cookie names to keep in sync with the mocked session.
   */
  authCookieKeys?: string[];
}

/**
 * Registers a Playwright route interceptor that matches requests using a URL
 * predicate function. Using a predicate (instead of a regex) avoids any risk
 * of ReDoS from user-supplied URL strings.
 *
 * @returns A {@link RouteHandle} that can be used to remove the route.
 */
async function registerRoute(
  page: Page,
  urlPredicate: (url: URL) => boolean,
  method: string | null,
  response: MockResponseOptions,
  defaultBody: unknown
): Promise<RouteHandle> {
  const handler = async (route: Route): Promise<void> => {
    if (method !== null && route.request().method().toUpperCase() !== method.toUpperCase()) {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: response.status ?? 200,
      headers: {
        ...DEFAULT_HEADERS,
        ...response.headers,
      },
      body: JSON.stringify(response.body !== undefined ? response.body : defaultBody),
    });
  };

  await page.route(urlPredicate, handler);

  return {
    dispose: async () => {
      await page.unroute(urlPredicate, handler);
    },
  };
}

/**
 * Builds a mock Supabase user object from an email address.
 *
 * The `username` is derived from the local part of the email, and the
 * `name` is a title-cased version split on `.`, `_`, or `-` separators.
 *
 * @example
 * ```ts
 * buildMockUser("jane.doe@example.com");
 * // { id: "mock-user:jane.doe@example.com", username: "jane.doe", name: "Jane Doe", ... }
 * ```
 */
function buildMockUser(email: string) {
  const username = email.split("@")[0] || "user";
  const name =
    username
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || username;

  return {
    id: `mock-user:${email}`,
    aud: "authenticated",
    role: "authenticated",
    email,
    username,
    name,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { username, name },
    identities: [],
    created_at: new Date(0).toISOString(),
  };
}

/**
 * Builds a mock Supabase session object from an email address.
 *
 * The session includes a mock access token, refresh token, and a user object
 * built via {@link buildMockUser}. The session expires one hour from the time
 * this function is called.
 *
 * @example
 * ```ts
 * buildMockSession("jane.doe@example.com");
 * // { access_token: "mock-access-token:jane.doe@example.com", user: { ... }, ... }
 * ```
 */
export function buildMockSession(email: string) {
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;
  return {
    access_token: `mock-access-token:${email}`,
    refresh_token: `mock-refresh-token:${email}`,
    token_type: "bearer",
    expires_in: 60 * 60,
    expires_at: expiresAt,
    user: buildMockUser(email),
  };
}

/**
 * Returns the Supabase auth cookie key for a Supabase project URL.
 *
 * @example
 * ```ts
 * getSupabaseAuthCookieKey("https://xyzcompany.supabase.co");
 * // "sb-xyzcompany-auth-token"
 * ```
 */
function getSupabaseAuthCookieKey(supabaseUrl: string | undefined) {
  if (!supabaseUrl) return null;
  try {
    const { hostname } = new URL(supabaseUrl);
    const projectRef = hostname.split(".")[0];
    return projectRef ? `sb-${projectRef}-auth-token` : null;
  } catch {
    return null;
  }
}

/**
 * Installs a mocked Supabase auth session into browser storage and cookies.
 */
function installMockSession({ sessionEmail, authCookieKeys }: AuthSpySeedPayload) {
  if (sessionEmail === undefined) return;

  const buildStoredSession = (email: string) => ({
    access_token: `mock-access-token:${email}`,
    refresh_token: `mock-refresh-token:${email}`,
    token_type: "bearer",
    expires_in: 60 * 60,
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
    user: {
      email,
    },
  });

  type StoredSession = ReturnType<typeof buildStoredSession>;
  type MockApiWindow = Window &
    typeof globalThis & {
      __playwrightSupabaseMockSession?: StoredSession | null;
      __playwrightSupabaseAuthStorageInstalled?: boolean;
    };

  const globalScope = window as MockApiWindow;

  const isSupabaseAuthTokenKey = (key: string) =>
    key.startsWith("sb-") && key.includes("-auth-token");

  const encodeBase64Url = (value: string) => {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  };

  const writeCookie = (name: string, value: string | null) => {
    const maxAge = value === null ? 0 : 400 * 24 * 60 * 60;
    document.cookie = `${name}=${value ?? ""}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
  };

  const syncSessionCookies = (session: StoredSession | null) => {
    authCookieKeys?.forEach((cookieName) => {
      writeCookie(cookieName, null);
      for (let i = 0; i < 5; i++) {
        writeCookie(`${cookieName}.${i}`, null);
      }
      if (session) {
        writeCookie(cookieName, `base64-${encodeBase64Url(JSON.stringify(session))}`);
      }
    });
  };

  globalScope.__playwrightSupabaseMockSession =
    sessionEmail === null ? null : buildStoredSession(sessionEmail);
  syncSessionCookies(globalScope.__playwrightSupabaseMockSession);

  if (globalScope.__playwrightSupabaseAuthStorageInstalled) return;

  const origGet = Storage.prototype.getItem;
  const origSet = Storage.prototype.setItem;
  const origRemove = Storage.prototype.removeItem;

  Storage.prototype.getItem = function (key: string) {
    if (isSupabaseAuthTokenKey(key)) {
      if (key.endsWith("-user")) return null;
      const session = (window as MockApiWindow).__playwrightSupabaseMockSession;
      return session ? JSON.stringify(session) : null;
    }
    return origGet.call(this, key);
  };

  Storage.prototype.setItem = function (key: string, value: string) {
    if (isSupabaseAuthTokenKey(key)) {
      if (!key.endsWith("-user")) {
        try {
          (window as MockApiWindow).__playwrightSupabaseMockSession = JSON.parse(
            value
          ) as StoredSession;
        } catch {
          (window as MockApiWindow).__playwrightSupabaseMockSession = null;
        }
        syncSessionCookies((window as MockApiWindow).__playwrightSupabaseMockSession ?? null);
      }
      return;
    }
    return origSet.call(this, key, value);
  };

  Storage.prototype.removeItem = function (key: string) {
    if (isSupabaseAuthTokenKey(key)) {
      if (!key.endsWith("-user")) {
        (window as MockApiWindow).__playwrightSupabaseMockSession = null;
        syncSessionCookies(null);
      }
      return;
    }
    return origRemove.call(this, key);
  };

  globalScope.__playwrightSupabaseAuthStorageInstalled = true;
}

/**
 * The main mock controller. Use {@link createSupabaseMock} to obtain an
 * instance bound to a Playwright `Page`.
 */
export class SupabaseMock {
  private readonly page: Page;
  private readonly baseUrl: string;
  private readonly supabaseAuthCookieKeys?: string[];

  constructor(page: Page, options: SupabaseMockOptions) {
    this.page = page;
    // Trim trailing slashes without a regex to avoid any backtracking on
    // user-controlled input.
    let url = options.url;
    while (url.endsWith("/")) {
      url = url.slice(0, -1);
    }
    this.baseUrl = url;
    const authCookieKey = getSupabaseAuthCookieKey(this.baseUrl);
    this.supabaseAuthCookieKeys = authCookieKey ? [authCookieKey] : undefined;
  }

  // ---------------------------------------------------------------------------
  // Database (PostgREST REST API – /rest/v1/)
  // ---------------------------------------------------------------------------

  /**
   * Returns a builder for mocking PostgREST operations against `table`.
   *
   * @example
   * ```ts
   * await supabaseMock.database("profiles").select({ body: [{ id: 1, name: "Alice" }] });
   * ```
   */
  database(table: string): DatabaseMockBuilder {
    const base = this.baseUrl;
    const tableUrl = new URL(`${base}/rest/v1/${table}`);
    const matchTable = (url: URL) =>
      url.origin === tableUrl.origin && url.pathname === tableUrl.pathname;

    return {
      select: (res: MockResponseOptions = {}) =>
        registerRoute(this.page, matchTable, "GET", res, []),

      insert: (res: MockResponseOptions = {}) =>
        registerRoute(this.page, matchTable, "POST", res, {}),

      update: (res: MockResponseOptions = {}) =>
        registerRoute(this.page, matchTable, "PATCH", res, {}),

      delete: (res: MockResponseOptions = {}) =>
        registerRoute(this.page, matchTable, "DELETE", res, {}),
    };
  }

  // ---------------------------------------------------------------------------
  // Auth (/auth/v1/)
  // ---------------------------------------------------------------------------

  /**
   * Returns a builder for mocking Supabase Auth endpoints.
   *
   * @example
   * ```ts
   * await supabaseMock.auth.signInWithPassword({
   *   body: { access_token: "tok", token_type: "bearer", user: { id: "u1" } },
   * });
   * ```
   */
  get auth(): AuthMockBuilder {
    const base = this.baseUrl;

    const matchAuth = (pathname: string, grantType?: string) =>
      (url: URL): boolean => {
        if (!url.href.startsWith(`${base}/auth/v1/${pathname}`)) return false;
        if (grantType !== undefined) {
          return url.searchParams.get("grant_type") === grantType;
        }
        return true;
      };

    return {
      signInWithPassword: (res: MockResponseOptions = {}) =>
        registerRoute(this.page, matchAuth("token", "password"), "POST", res, {}),

      signUp: (res: MockResponseOptions = {}) =>
        registerRoute(this.page, matchAuth("signup"), "POST", res, {}),

      signOut: (res: MockResponseOptions = {}) =>
        registerRoute(this.page, matchAuth("logout"), "POST", res, {}),

      getUser: (res: MockResponseOptions = {}) =>
        registerRoute(this.page, matchAuth("user"), "GET", res, {}),

      refreshToken: (res: MockResponseOptions = {}) =>
        registerRoute(this.page, matchAuth("token", "refresh_token"), "POST", res, {}),
    };
  }

  /**
   * Seeds a mocked current user session into the page's auth storage.
   */
  async mockCurrentUser(sessionEmail: string | null | undefined): Promise<void> {
    const payload: AuthSpySeedPayload = {
      sessionEmail,
      authCookieKeys: this.supabaseAuthCookieKeys,
    };
    await this.page.addInitScript(installMockSession, payload);
    if (this.page.url() !== "about:blank") {
      await this.page.evaluate(installMockSession, payload);
    }
  }

  // ---------------------------------------------------------------------------
  // Storage (/storage/v1/)
  // ---------------------------------------------------------------------------

  /**
   * Returns a builder for mocking Supabase Storage operations against `bucket`.
   *
   * @example
   * ```ts
   * await supabaseMock.storage("avatars").list({ body: [{ name: "photo.png" }] });
   * ```
   */
  storage(bucket: string): StorageMockBuilder {
    const base = this.baseUrl;

    const matchStorage = (path: string) =>
      (url: URL): boolean =>
        url.href.startsWith(`${base}/storage/v1/${path}`);

    return {
      list: (res: MockResponseOptions = {}) =>
        registerRoute(
          this.page,
          matchStorage(`object/list/${bucket}`),
          "POST",
          res,
          []
        ),

      upload: (res: MockResponseOptions = {}) =>
        registerRoute(
          this.page,
          matchStorage(`object/${bucket}`),
          "POST",
          res,
          {}
        ),

      download: (filePath: string, res: MockResponseOptions = {}) =>
        registerRoute(
          this.page,
          matchStorage(`object/${bucket}/${filePath}`),
          "GET",
          res,
          {}
        ),

      remove: (res: MockResponseOptions = {}) =>
        registerRoute(
          this.page,
          matchStorage(`object/${bucket}`),
          "DELETE",
          res,
          {}
        ),
    };
  }
}
