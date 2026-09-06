import { test } from "node:test";
import assert from "node:assert/strict";

import { PLAYWRIGHT_DEFAULTS } from "../dist/playwright.js";
import { VITEST_SHARED_EXCLUDE } from "../dist/vitest.js";
import { AUTH_STATE_PATH } from "../dist/auth.js";

test("PLAYWRIGHT_DEFAULTS carries the shared shape consumers rely on", () =>
{
    assert.equal(PLAYWRIGHT_DEFAULTS.testDir, ".");
    assert.equal(PLAYWRIGHT_DEFAULTS.testMatch, "**/*.spec.ts");
    assert.deepEqual(
        PLAYWRIGHT_DEFAULTS.testIgnore.map(String),
        [/worktrees/, /\.claude/].map(String),
    );
    assert.equal(PLAYWRIGHT_DEFAULTS.use.ignoreHTTPSErrors, true);
    assert.deepEqual(PLAYWRIGHT_DEFAULTS.use.launchOptions.args, ["--disable-dev-shm-usage"]);
    assert.equal(PLAYWRIGHT_DEFAULTS.use.locale, "he-IL");
    assert.equal(PLAYWRIGHT_DEFAULTS.use.timezoneId, "Asia/Jerusalem");
});

test("VITEST_SHARED_EXCLUDE includes the .claude and worktrees carve-outs", () =>
{
    assert.ok(VITEST_SHARED_EXCLUDE.includes("**/.claude/**"));
    assert.ok(VITEST_SHARED_EXCLUDE.includes("**/worktrees/**"));
});

test("AUTH_STATE_PATH points at tests/.auth/user.json", () =>
{
    assert.ok(AUTH_STATE_PATH.replace(/\\/g, "/").endsWith("tests/.auth/user.json"));
});
