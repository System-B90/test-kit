import * as fs from "node:fs";
import * as path from "node:path";

import type { Browser, Page } from "@playwright/test";
import { expect } from "@playwright/test";

/** Default location Playwright storage state gets written to / read from. */
export const AUTH_STATE_PATH = path.join(process.cwd(), "tests", ".auth", "user.json");

export interface HiveLoginOptions
{
    baseURL: string;
    username: string;
    password: string;
    /** Where to persist storage state. Defaults to {@link AUTH_STATE_PATH}. */
    authFile?: string;
    /**
     * Locator (CSS selector or role text) whose visibility, after login,
     * confirms the app actually loaded — e.g. a calendar root or app bar.
     * When omitted, login only waits for navigation away from the SSO/login
     * host.
     */
    successSelector?: string;
}

async function waitForAuthApi(page: Page, baseURL: string): Promise<void>
{
    for (let attempt = 1; attempt <= 10; attempt++)
    {
        try
        {
            const response = await page.request.get(`${baseURL}/api/auth/csrf`);
            if (response.ok())
            {
                return;
            }
        } catch
        {
            // Ignore error and retry
        }

        await page.waitForTimeout(3_000);
    }

    throw new Error("NextAuth API is not ready");
}

async function startHiveSso(page: Page, baseURL: string): Promise<void>
{
    await waitForAuthApi(page, baseURL);

    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++)
    {
        try
        {
            const csrfResponse = await page.request.get(`${baseURL}/api/auth/csrf`);
            if (!csrfResponse.ok())
            {
                throw new Error(`CSRF request failed: ${csrfResponse.status()}`);
            }

            const { csrfToken } = await csrfResponse.json();
            const signInResponse = await page.request.post(
                `${baseURL}/api/auth/signin/hive`,
                {
                    form: {
                        csrfToken,
                        callbackUrl: `${baseURL}/`,
                        json: "true",
                    },
                },
            );
            if (!signInResponse.ok())
            {
                throw new Error(`Sign-in request failed: ${signInResponse.status()}`);
            }

            const signInData = await signInResponse.json();

            await page.goto(signInData.url, { waitUntil: "commit", timeout: 60_000 });
            await page.waitForURL(/hive\.org/, { timeout: 60_000 });
            return;
        } catch (error)
        {
            if (attempt === maxAttempts)
            {
                throw error;
            }

            await page.waitForTimeout(3_000 * attempt);
        }
    }
}

async function tryGoto(page: Page, url: string, timeout = 30_000): Promise<boolean>
{
    try
    {
        const response = await page.goto(url, { waitUntil: "commit", timeout });
        return !!response && response.status() < 500;
    } catch
    {
        return false;
    }
}

async function gotoReliable(page: Page, url: string): Promise<void>
{
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++)
    {
        if (await tryGoto(page, url, 45_000))
        {
            return;
        }

        if (attempt < maxAttempts)
        {
            await page.waitForTimeout(2_000 * attempt);
        }
    }

    throw new Error(`Failed to navigate to ${url}`);
}

/**
 * Performs the shared Hive SSO form login: seeds NextAuth CSRF cookies, starts
 * OAuth via the API (rather than clicking the login button, so setup does not
 * depend on client-side React hydration), fills the Hive credentials form,
 * dismisses an optional "Authorize" consent screen, and waits for navigation
 * back to the app. Persists storage state to `authFile` on success.
 *
 * Consumers that need to reuse a previously-saved session (skip SSO when the
 * cookie is still valid) or run a second, independent login for multi-user
 * tests should wrap this with their own reuse/second-session logic — this
 * function only covers the shared SSO core (bluz's and madash's `auth.setup.ts`
 * were otherwise byte-for-byte identical here).
 */
export async function hiveLogin(
    page: Page,
    { baseURL, username, password, successSelector }: HiveLoginOptions,
): Promise<void>
{
    await gotoReliable(page, "/login");

    if (!page.url().includes("/login"))
    {
        return;
    }

    await startHiveSso(page, baseURL);

    const usernameField = page
        .locator("input[name='username'], input[name='login'], input[type='text']")
        .first();
    const passwordField = page
        .locator("input[name='password'], input[type='password']")
        .first();

    await usernameField.waitFor({ state: "visible", timeout: 30_000 });
    await usernameField.fill(username);
    await passwordField.fill(password);

    const submitButton = page
        .locator("button[type='submit'], input[type='submit']")
        .first();
    await submitButton.click();

    try
    {
        const authorizeButton = page.locator(
            "button:has-text('Authorize'), button:has-text('Allow'), button:has-text('אשר'), input[type='submit'][value='Authorize']",
        );
        await authorizeButton.waitFor({ state: "visible", timeout: 5_000 });
        await authorizeButton.click();
    } catch
    {
        // No authorization screen — continue
    }

    await page.waitForURL(
        (url) => !url.hostname.includes("hive") && !url.pathname.includes("/login"),
        { timeout: 60_000 },
    );

    if (successSelector)
    {
        await expect(page.locator(successSelector)).toBeVisible({ timeout: 60_000 });
    }
}

/**
 * Full setup-project helper: reuses a saved session if it is still valid,
 * otherwise runs {@link hiveLogin} and writes storage state to `authFile`
 * (default {@link AUTH_STATE_PATH}).
 */
export async function authenticateViaHive(
    browser: Browser,
    options: HiveLoginOptions,
): Promise<void>
{
    const authFile = options.authFile ?? AUTH_STATE_PATH;
    const authDir = path.dirname(authFile);
    if (!fs.existsSync(authDir))
    {
        fs.mkdirSync(authDir, { recursive: true });
    }

    // Try to reuse a previously saved session before starting SSO.
    if (fs.existsSync(authFile))
    {
        const reuseContext = await browser.newContext({ storageState: authFile });
        const reusePage = await reuseContext.newPage();

        if ((await tryGoto(reusePage, options.baseURL)) && !reusePage.url().includes("/login"))
        {
            await reuseContext.storageState({ path: authFile });
            await reuseContext.close();
            return;
        }

        await reuseContext.close();
    }

    const context = await browser.newContext();
    const page = await context.newPage();

    await hiveLogin(page, options);

    await context.storageState({ path: authFile });
    await context.close();
}
