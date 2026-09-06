# @system-b90/test-kit

Shared Playwright/Vitest test scaffolding for System-B90 apps (bluz, madash, peek-a-boo),
factored out of three near-identical copies of `tests/playwright.config.ts`,
`tests/vitest.config.ts`, `tests/auth.setup.ts` and `tests/fixtures.ts`
(System-B90/Bluz#226, row 2 — row 1 shipped as `@system-b90/devops-py`, row 3 was dropped).

`@playwright/test` and `vitest` are peer dependencies — install whichever your repo
already uses.

## Install

```powershell
"@system-b90:registry=https://npm.pkg.github.com" | Out-File -Append $HOME\.npmrc
"//npm.pkg.github.com/:_authToken=$env:GITHUB_TOKEN" | Out-File -Append $HOME\.npmrc

npm install @system-b90/test-kit
```

## `@system-b90/test-kit/playwright`

`definePlaywrightConfig(options?)` merges your `options` over the shared defaults
(`testDir`, `testMatch`, `testIgnore`, `forbidOnly`/`retries`/`reporter` keyed on `CI`,
`ignoreHTTPSErrors`, the `--disable-dev-shm-usage` + `PLAYWRIGHT_CHROMIUM_EXECUTABLE`
launch options, `he-IL`/`Asia/Jerusalem`) and runs it through Playwright's own
`defineConfig`. The `use` block merges one level deep; every other top-level field
(`projects`, `webServer`, `timeout`, `workers`, …) is yours to supply.

**Before** (bluz's old `tests/playwright.config.ts`, ~90 lines):

```ts
import * as path from "path";
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
    testDir: ".",
    testMatch: "**/*.spec.ts",
    testIgnore: [/worktrees/, /\.claude/],
    timeout: 15_000,
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 1,
    workers: 1,
    reporter: process.env.CI ? [["html"], ["github"]] : [["html"], ["list"]],
    use: {
        baseURL: process.env.BASE_URL ?? "https://bluz.dev",
        ignoreHTTPSErrors: true,
        launchOptions: {
            args: ["--disable-dev-shm-usage"],
            executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
        },
        screenshot: "only-on-failure",
        video: "on-first-retry",
        trace: "retain-on-failure",
        locale: "he-IL",
        timezoneId: "Asia/Jerusalem",
    },
    projects: [/* … */],
});
```

**After:**

```ts
import { devices } from "@playwright/test";
import { definePlaywrightConfig } from "@system-b90/test-kit/playwright";

export default definePlaywrightConfig({
    timeout: 15_000,
    fullyParallel: false,
    workers: 1,
    use: {
        baseURL: process.env.BASE_URL ?? "https://bluz.dev",
        screenshot: "only-on-failure",
        video: "on-first-retry",
        trace: "retain-on-failure",
    },
    projects: [/* … */],
});
```

## `@system-b90/test-kit/vitest`

`defineSharedVitestConfig(options?)` merges `resolve: { tsconfigPaths: true }`, a
`"node"` environment, and the shared `exclude` (`configDefaults.exclude` plus
`.claude`/`worktrees`) with your `root`/`include`/`setupFiles`/`alias`, plus any other
`test`-level fields under `test` and any other top-level fields under `config`.

**Before:**

```ts
import path from "path";
import tsconfigPaths from "vite-tsconfig-paths";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
    plugins: [tsconfigPaths({ projects: [path.resolve(__dirname, "../tsconfig.json")] })],
    test: {
        environment: "node",
        include: ["tests/backend/**/*.test.ts"],
        exclude: [...configDefaults.exclude, "**/.claude/**", "**/worktrees/**"],
        alias: { "@": path.resolve(__dirname, "../src") },
        env: { SYM_ENC_KEY: process.env.SYM_ENC_KEY ?? "…" },
    },
});
```

**After:**

```ts
import path from "path";
import { defineSharedVitestConfig } from "@system-b90/test-kit/vitest";

export default defineSharedVitestConfig({
    include: ["tests/backend/**/*.test.ts"],
    alias: { "@": path.resolve(__dirname, "../src") },
    test: { env: { SYM_ENC_KEY: process.env.SYM_ENC_KEY ?? "…" } },
});
```

## `@system-b90/test-kit/auth`

- `hiveLogin(page, { baseURL, username, password, successSelector? })` — the shared
  Hive SSO form-login core (seed CSRF, start OAuth via the API, fill credentials,
  dismiss an optional consent screen, wait for navigation back to the app).
- `authenticateViaHive(browser, options)` — `hiveLogin` plus the reuse-saved-session
  and storage-state-persistence wrapper bluz/madash's `auth.setup.ts` both had.
- `AUTH_STATE_PATH` — default storage-state path (`tests/.auth/user.json`).

**Before** (bluz/madash's ~120-line shared SSO core inside `auth.setup.ts`):

```ts
setup("authenticate via Hive SSO", async ({ browser }) => {
    // ~120 lines: waitForAuthApi, startHiveSso, tryGoto, gotoReliable,
    // reuse-session check, form fill, optional Authorize click, storageState …
});
```

**After:**

```ts
import { test as setup } from "@playwright/test";
import { authenticateViaHive } from "@system-b90/test-kit/auth";

setup("authenticate via Hive SSO", async ({ browser }) => {
    await authenticateViaHive(browser, {
        baseURL: setup.info().project.use.baseURL as string,
        username: "admin",
        password: "Password1",
        successSelector: ".rbc-calendar",
    });
});
```

## `@system-b90/test-kit/fixtures`

The common first ~9 lines shared by bluz's and madash's `tests/fixtures.ts`: a `test`
extension that reuses one browser context/page across the run when `TEST_VISUAL=1`
(useful for watching a run in a real window), and a plain re-export of `expect`.
Per-repo fixtures (selectors, server-state isolation, helpers) stay in each consumer's
own `tests/fixtures.ts`, built with `test.extend()` on top of this base.

**Before:**

```ts
export const test = baseTest.extend({
    context: async ({ browser, contextOptions }, use) => {
        if (process.env.TEST_VISUAL === "1") { /* … reuse shared context … */ }
        else { /* … fresh context per test … */ }
    },
    page: async ({ context }, use) => { /* same pattern */ },
});
export const expect = baseExpect;
```

**After:**

```ts
import { test as sharedTest, expect } from "@system-b90/test-kit/fixtures";

export const test = sharedTest.extend({
    // repo-specific fixtures (serverStateIsolation, etc.)
});
export { expect };
```

## Publishing

CI publishes on GitHub Release (or manual dispatch) via `.github/workflows/publish.yml`.
Bump `version` in `package.json` before releasing.
