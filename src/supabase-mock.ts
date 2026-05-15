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
 * The main mock controller. Use {@link createSupabaseMock} to obtain an
 * instance bound to a Playwright `Page`.
 */
export class SupabaseMock {
  private readonly page: Page;
  private readonly baseUrl: string;

  constructor(page: Page, options: SupabaseMockOptions) {
    this.page = page;
    // Trim trailing slashes without a regex to avoid any backtracking on
    // user-controlled input.
    let url = options.url;
    while (url.endsWith("/")) {
      url = url.slice(0, -1);
    }
    this.baseUrl = url;
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
    const prefix = `${base}/rest/v1/${table}`;
    const matchTable = (url: URL) => url.href.startsWith(prefix);

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
