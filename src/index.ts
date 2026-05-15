/**
 * @asghonim/playwright-supabase
 * -------------------
 * Utilities for mocking Supabase API calls inside Playwright tests.
 *
 * @example
 * ```ts
 * import { createSupabaseMock } from "@asghonim/playwright-supabase";
 *
 * test("shows profiles", async ({ page }) => {
 *   const mock = createSupabaseMock(page, { url: "https://xyz.supabase.co" });
 *   await mock.database("profiles").select({ body: [{ id: 1, name: "Alice" }] });
 *   await page.goto("/profiles");
 * });
 * ```
 */
import { SupabaseMock } from "./supabase-mock.js";
import type { SupabaseMockOptions, Page } from "./types.js";

export { SupabaseMock } from "./supabase-mock.js";
export { test, expect } from "./fixtures.js";
export type {
  SupabaseMockOptions,
  MockResponseOptions,
  RouteHandle,
  DatabaseMockBuilder,
  AuthMockBuilder,
  StorageMockBuilder,
} from "./types.js";
export type { SupabaseFixtures, SupabaseFixtureOptions } from "./fixtures.js";

/**
 * Create a {@link SupabaseMock} instance bound to a Playwright `Page`.
 *
 * @param page    - The Playwright `Page` to attach route interceptors to.
 * @param options - Configuration including the Supabase project URL.
 *
 * @example
 * ```ts
 * const mock = createSupabaseMock(page, { url: process.env.SUPABASE_URL! });
 * await mock.database("todos").select({ body: [] });
 * ```
 */
export function createSupabaseMock(
  page: Page,
  options: SupabaseMockOptions
): SupabaseMock {
  return new SupabaseMock(page, options);
}
