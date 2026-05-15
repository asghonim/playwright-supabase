import type { Page } from "@playwright/test";

/**
 * Options for creating a SupabaseMock instance.
 */
export interface SupabaseMockOptions {
  /**
   * The base URL of your Supabase project, e.g. "https://xyz.supabase.co".
   * Trailing slashes are ignored.
   */
  url: string;
}

/**
 * Options to control the mocked HTTP response.
 */
export interface MockResponseOptions {
  /**
   * The response body that will be JSON-serialised and returned.
   * Defaults to an empty array `[]` for database responses and `{}` for others.
   */
  body?: unknown;
  /**
   * HTTP status code. Defaults to 200.
   */
  status?: number;
  /**
   * Extra headers to include in the mocked response.
   */
  headers?: Record<string, string>;
}

/**
 * Represents a pending route mock that can be cleaned up.
 */
export interface RouteHandle {
  /** Remove this specific mock route. */
  dispose(): Promise<void>;
}

/**
 * A fluent builder returned by `SupabaseMock.database(table)`.
 */
export interface DatabaseMockBuilder {
  /**
   * Mock SELECT requests (GET) against the table.
   * The `body` should be an array of row objects.
   */
  select(response?: MockResponseOptions): Promise<RouteHandle>;

  /**
   * Mock INSERT requests (POST) against the table.
   */
  insert(response?: MockResponseOptions): Promise<RouteHandle>;

  /**
   * Mock UPDATE requests (PATCH) against the table.
   */
  update(response?: MockResponseOptions): Promise<RouteHandle>;

  /**
   * Mock DELETE requests (DELETE) against the table.
   */
  delete(response?: MockResponseOptions): Promise<RouteHandle>;
}

/**
 * A fluent builder returned by `SupabaseMock.auth`.
 */
export interface AuthMockBuilder {
  /**
   * Mock the sign-in with password endpoint (`POST /auth/v1/token?grant_type=password`).
   */
  signInWithPassword(response?: MockResponseOptions): Promise<RouteHandle>;

  /**
   * Mock the sign-up endpoint (`POST /auth/v1/signup`).
   */
  signUp(response?: MockResponseOptions): Promise<RouteHandle>;

  /**
   * Mock the sign-out endpoint (`POST /auth/v1/logout`).
   */
  signOut(response?: MockResponseOptions): Promise<RouteHandle>;

  /**
   * Mock the get-user endpoint (`GET /auth/v1/user`).
   */
  getUser(response?: MockResponseOptions): Promise<RouteHandle>;

  /**
   * Mock the token refresh endpoint (`POST /auth/v1/token?grant_type=refresh_token`).
   */
  refreshToken(response?: MockResponseOptions): Promise<RouteHandle>;
}

/**
 * A fluent builder returned by `SupabaseMock.storage(bucket)`.
 */
export interface StorageMockBuilder {
  /**
   * Mock the list-objects endpoint (`GET /storage/v1/object/list/<bucket>`).
   */
  list(response?: MockResponseOptions): Promise<RouteHandle>;

  /**
   * Mock the upload endpoint (`POST /storage/v1/object/<bucket>`).
   */
  upload(response?: MockResponseOptions): Promise<RouteHandle>;

  /**
   * Mock the download/get-object endpoint (`GET /storage/v1/object/<bucket>/<path>`).
   */
  download(path: string, response?: MockResponseOptions): Promise<RouteHandle>;

  /**
   * Mock the delete-object endpoint (`DELETE /storage/v1/object/<bucket>`).
   */
  remove(response?: MockResponseOptions): Promise<RouteHandle>;
}

/**
 * Input for seeding a mocked Supabase auth session into browser storage.
 */
export interface AuthSpySeedPayload {
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
 * Playwright `Page` type re-exported for convenience.
 * @internal
 */
export type { Page };
