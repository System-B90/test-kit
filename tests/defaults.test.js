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

test("MATTERMOST_COMPOSE_FILE ships with the package and binds a dedicated loopback", async () =>
{
    const { readFile } = await import("node:fs/promises");
    const { MATTERMOST_COMPOSE_FILE } = await import("../dist/mattermost.js");
    const compose = await readFile(MATTERMOST_COMPOSE_FILE, "utf8");
    assert.match(compose, /\$\{MATTERMOST_TEST_HOST:-127\.0\.0\.18\}:\$\{MATTERMOST_TEST_PORT:-8065\}:8065/);
    assert.match(compose, /MM_SERVICESETTINGS_ENABLEBOTACCOUNTCREATION: "true"/);
    assert.match(compose, /MM_SERVICESETTINGS_ENABLEUSERACCESSTOKENS: "true"/);
});

test("resolveMattermostHost prefers the hostname only when it resolves to the bind address", async () =>
{
    const { resolveMattermostHost } = await import("../dist/mattermost.js");
    assert.equal(await resolveMattermostHost("localhost", "127.0.0.1"), "localhost");
    assert.equal(await resolveMattermostHost("localhost", "127.0.0.18"), "127.0.0.18");
    assert.equal(await resolveMattermostHost("no-such-host.invalid", "127.0.0.18"), "127.0.0.18");
});
