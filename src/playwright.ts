import { defineConfig, type PlaywrightTestConfig } from "@playwright/test";

/**
 * Shared Playwright defaults, factored out of bluz/madash/peek-a-boo's
 * near-identical `tests/playwright.config.ts` files (System-B90/Bluz#226).
 *
 * Every field here can be overridden by the caller's `options` — this module
 * only supplies sane defaults, it never forces a value on a consumer.
 */
export const PLAYWRIGHT_DEFAULTS: PlaywrightTestConfig = {
    testDir: ".",
    testMatch: "**/*.spec.ts",
    testIgnore: [/worktrees/, /\.claude/],
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 1,
    reporter: process.env.CI ? [["html"], ["github"]] : [["html"], ["list"]],

    use: {
        ignoreHTTPSErrors: true,
        // Chromium keeps shared-memory tabs in /dev/shm, which is only 64 MB
        // by default inside containers — exhausting it crashes the tab/browser
        // ("Target page/context/browser has been closed"), cascading to every
        // later test in the worker. The self-hosted runner also raises
        // shm_size, but this flag makes any container host safe.
        launchOptions: {
            args: ["--disable-dev-shm-usage"],
            // Escape hatch for hosts that ship their own Chromium instead of
            // letting Playwright download one. A cloud agent container
            // preinstalls a browser under PLAYWRIGHT_BROWSERS_PATH and blocks
            // `playwright install`, so when its build number does not match
            // the one this @playwright/test expects, every test dies at
            // launch with "Executable doesn't exist at …". Pointing this at
            // the browser that is actually present costs nothing anywhere
            // else: unset (CI, workstations) it stays undefined and Playwright
            // resolves its own managed build exactly as before.
            executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
        },
        locale: "he-IL",
        timezoneId: "Asia/Jerusalem",
    },
};

/**
 * Merges caller `options` over `PLAYWRIGHT_DEFAULTS` and runs the result
 * through Playwright's own `defineConfig`.
 *
 * The `use` block is merged one level deep so a caller overriding e.g.
 * `use.baseURL` does not have to also repeat `ignoreHTTPSErrors`,
 * `launchOptions`, `locale`, etc. Everything else (top-level keys such as
 * `projects`, `webServer`, `timeout`, `workers`) is the caller's alone —
 * pass what you need.
 */
export function definePlaywrightConfig(
    options: PlaywrightTestConfig = {},
): ReturnType<typeof defineConfig>
{
    const { use: overrideUse, ...overrideRest } = options;

    return defineConfig({
        ...PLAYWRIGHT_DEFAULTS,
        ...overrideRest,
        use: {
            ...PLAYWRIGHT_DEFAULTS.use,
            ...overrideUse,
        },
    });
}
