import { test as baseTest, expect as baseExpect, type BrowserContext, type Page } from "@playwright/test";

/**
 * Shared fixture base, factored out of the first ~9 lines common to bluz's
 * and madash's `tests/fixtures.ts` (System-B90/Bluz#226): a `test` extension
 * that reuses a single browser context/page across the whole run when
 * `TEST_VISUAL=1`, and a plain re-export of `expect`.
 *
 * Per-repo fixtures (server-state isolation, selectors, helpers) stay in each
 * consumer's own `tests/fixtures.ts`, built with `test.extend()` on top of
 * this base.
 */

let sharedContext: BrowserContext | null = null;
let sharedPage: Page | null = null;

export const test = baseTest.extend({
    context: async ({ browser, contextOptions }, use) =>
    {
        if (process.env.TEST_VISUAL === "1")
        {
            if (!sharedContext)
            {
                sharedContext = await browser.newContext(contextOptions);
            }
            await use(sharedContext);
        } else
        {
            const context = await browser.newContext(contextOptions);
            await use(context);
            await context.close();
        }
    },
    page: async ({ context }, use) =>
    {
        if (process.env.TEST_VISUAL === "1")
        {
            if (!sharedPage)
            {
                sharedPage = await context.newPage();
            }
            await use(sharedPage);
        } else
        {
            const page = await context.newPage();
            await use(page);
            await page.close();
        }
    },
});

export const expect = baseExpect;
