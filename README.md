# playwright-supabase

> Setup Supabase mocks in Playwright tests

A lightweight TypeScript library that intercepts Supabase API calls (database, auth, storage) inside [Playwright](https://playwright.dev/) tests using Playwright's built-in route interception — no network required.

## Installation

```sh
npm install --save-dev playwright-supabase
# or
yarn add -D playwright-supabase
# or
pnpm add -D playwright-supabase
```

`@playwright/test` must be installed as a peer dependency.

## Quick start

### Using `createSupabaseMock` directly

```ts
import { test, expect } from "@playwright/test";
import { createSupabaseMock } from "playwright-supabase";

test("shows a list of todos", async ({ page }) => {
  const mock = createSupabaseMock(page, {
    url: "https://xyz.supabase.co",
  });

  // Mock a SELECT on the "todos" table
  await mock.database("todos").select({
    body: [
      { id: 1, title: "Buy milk", done: false },
      { id: 2, title: "Write tests", done: true },
    ],
  });

  await page.goto("/todos");
  await expect(page.locator("text=Buy milk")).toBeVisible();
});
```

### Using the built-in Playwright fixture

`playwright-supabase` ships a pre-built `test` object with a `supabaseMock` fixture.

```ts
// tests/todos.spec.ts
import { test, expect } from "playwright-supabase";

// Set the Supabase URL once for all tests in this file
test.use({ supabaseUrl: "https://xyz.supabase.co" });

test("shows a list of todos", async ({ page, supabaseMock }) => {
  await supabaseMock.database("todos").select({
    body: [{ id: 1, title: "Buy milk" }],
  });

  await page.goto("/todos");
  await expect(page.locator("text=Buy milk")).toBeVisible();
});
```

You can also read the URL from an environment variable by setting `SUPABASE_URL` before running Playwright.

### Composing with your own fixtures

```ts
// tests/fixtures.ts
import { test as base, expect } from "@playwright/test";
import { SupabaseMock } from "playwright-supabase";

export const test = base.extend<{ supabaseMock: SupabaseMock }>({
  supabaseMock: async ({ page }, use) => {
    await use(new SupabaseMock(page, { url: process.env.SUPABASE_URL! }));
  },
});

export { expect };
```

## API

### `createSupabaseMock(page, options)`

Creates a `SupabaseMock` instance.

| Parameter | Type | Description |
|---|---|---|
| `page` | `Page` | The Playwright `Page` to attach interceptors to |
| `options.url` | `string` | Base URL of your Supabase project (trailing slash is trimmed) |

---

### `SupabaseMock`

#### `.database(table)`

Returns a builder for mocking [PostgREST](https://postgrest.org/) endpoints at `/rest/v1/<table>`.

| Method | HTTP verb mocked | Default body |
|---|---|---|
| `.select(response?)` | `GET` | `[]` |
| `.insert(response?)` | `POST` | `{}` |
| `.update(response?)` | `PATCH` | `{}` |
| `.delete(response?)` | `DELETE` | `{}` |

All methods return a `RouteHandle` with a `.dispose()` method to remove the mock.

#### `.auth`

Builder for mocking Supabase Auth endpoints at `/auth/v1/`.

| Method | Endpoint mocked |
|---|---|
| `.signInWithPassword(response?)` | `POST /auth/v1/token?grant_type=password` |
| `.signUp(response?)` | `POST /auth/v1/signup` |
| `.signOut(response?)` | `POST /auth/v1/logout` |
| `.getUser(response?)` | `GET /auth/v1/user` |
| `.refreshToken(response?)` | `POST /auth/v1/token?grant_type=refresh_token` |

#### `.storage(bucket)`

Builder for mocking Supabase Storage endpoints at `/storage/v1/`.

| Method | Endpoint mocked |
|---|---|
| `.list(response?)` | `POST /storage/v1/object/list/<bucket>` |
| `.upload(response?)` | `POST /storage/v1/object/<bucket>` |
| `.download(path, response?)` | `GET /storage/v1/object/<bucket>/<path>` |
| `.remove(response?)` | `DELETE /storage/v1/object/<bucket>` |

---

### `MockResponseOptions`

All mock builders accept an optional `MockResponseOptions` object:

```ts
interface MockResponseOptions {
  body?: unknown;                     // JSON-serialisable response body
  status?: number;                    // HTTP status code (default: 200)
  headers?: Record<string, string>;   // Extra response headers
}
```

---

### `RouteHandle`

Every mock registration returns a `RouteHandle`:

```ts
interface RouteHandle {
  dispose(): Promise<void>; // Removes the route interceptor
}
```

## Development

```sh
npm install
npm run build      # compile with tsup
npm test           # run unit tests with vitest
npm run typecheck  # run tsc --noEmit
npm run lint       # ESLint
```

## License

MIT
