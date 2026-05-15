import { test as base } from "@playwright/test";
import { SupabaseMock } from "./supabase-mock.js";
import type { SupabaseMockOptions } from "./types.js";

/**
 * Additional fixtures exposed by `playwright-supabase`.
 */
export interface SupabaseFixtures {
  /**
   * A pre-configured {@link SupabaseMock} instance bound to the current
   * `page`. The Supabase URL is read from the `SUPABASE_URL` environment
   * variable by default, but can be overridden via `use` options.
   */
  supabaseMock: SupabaseMock;
}

/**
 * Options that can be set via `test.use(...)` to configure the
 * `supabaseMock` fixture.
 */
export interface SupabaseFixtureOptions {
  /**
   * The Supabase project URL, e.g. `"https://xyz.supabase.co"`.
   * Defaults to the `SUPABASE_URL` environment variable.
   */
  supabaseUrl: string;
}

/**
 * Extended Playwright test object that includes the `supabaseMock` fixture.
 *
 * @example
 * ```ts
 * // playwright/fixtures.ts
 * import { test, expect } from "playwright-supabase/fixtures";
 *
 * test("lists users", async ({ page, supabaseMock }) => {
 *   await supabaseMock.database("users").select({
 *     body: [{ id: 1, email: "alice@example.com" }],
 *   });
 *   await page.goto("/users");
 *   await expect(page.locator("text=alice@example.com")).toBeVisible();
 * });
 * ```
 */
export const test = base.extend<SupabaseFixtures & SupabaseFixtureOptions>({
  // Allow supabaseUrl to be configured via test.use(...)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseUrl: [(globalThis as any).process?.env?.["SUPABASE_URL"] ?? "", { option: true }],

  supabaseMock: async ({ page, supabaseUrl }, use) => {
    const options: SupabaseMockOptions = { url: supabaseUrl };
    const mock = new SupabaseMock(page, options);
    await use(mock);
  },
});

export { expect } from "@playwright/test";
