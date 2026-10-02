import { execFile } from "node:child_process";
import { lookup } from "node:dns/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * The compose file shipped with this package — a test-shaped copy of
 * https://github.com/mattermost/docker (see the comments at its top).
 */
export const MATTERMOST_COMPOSE_FILE: string = fileURLToPath(
    new URL("../mattermost/docker-compose.yml", import.meta.url),
);

/** Default credentials of the system admin `bootstrapMattermost()` creates. */
export const MATTERMOST_ADMIN = {
    username: "sysadmin",
    email: "sysadmin@example.com",
    password: "Sysadmin-Passw0rd!",
} as const;

// ── Minimal REST client ──────────────────────────────────────────────────────

export class MattermostRequestError extends Error
{
    constructor(readonly status: number, readonly body: string, message: string)
    {
        super(message);
        this.name = "MattermostRequestError";
    }
}

/**
 * Just enough of the Mattermost v4 API to set up fixtures and assert on what
 * the app under test posted. Not a general-purpose client.
 */
export class MattermostClient
{
    constructor(readonly url: string, readonly token?: string) {}

    async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T>
    {
        const headers = new Headers(init.headers);
        if (this.token) headers.set("Authorization", `Bearer ${this.token}`);
        if (typeof init.body === "string") headers.set("Content-Type", "application/json");

        const res = await fetch(`${this.url}/api/v4${path}`, { ...init, headers });
        const text = await res.text();
        if (!res.ok)
        {
            throw new MattermostRequestError(
                res.status,
                text,
                `${init.method ?? "GET"} ${path} -> ${res.status}: ${text}`,
            );
        }
        return (text ? JSON.parse(text) : undefined) as T;
    }

    post<T = unknown>(path: string, body: unknown): Promise<T>
    {
        return this.request<T>(path, { method: "POST", body: JSON.stringify(body) });
    }

    /** Posts in a channel, newest first. */
    async getPosts(channelId: string): Promise<Array<MattermostPost>>
    {
        const res = await this.request<{ order: Array<string>; posts: Record<string, MattermostPost> }>(
            `/channels/${channelId}/posts`,
        );
        return res.order.map((id) => res.posts[id]);
    }

    getFileInfo(fileId: string): Promise<MattermostFileInfo>
    {
        return this.request<MattermostFileInfo>(`/files/${fileId}/info`);
    }

    /** Opens (or returns the existing) direct-message channel between two users. */
    async getDirectChannel(userIdA: string, userIdB: string): Promise<{ id: string }>
    {
        return this.post<{ id: string }>("/channels/direct", [userIdA, userIdB]);
    }
}

export interface MattermostPost
{
    id: string;
    channel_id: string;
    user_id: string;
    message: string;
    file_ids?: Array<string>;
}

export interface MattermostFileInfo
{
    id: string;
    name: string;
    extension: string;
    mime_type: string;
    size: number;
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

export interface StartMattermostOptions
{
    /** Compose project name; isolates parallel runs. Default `test-kit-mattermost`. */
    projectName?: string;
    /**
     * Host address the app is published on. Default `127.0.0.18` (or
     * `MATTERMOST_TEST_HOST`) — a dedicated loopback address so the test
     * server never collides with anything bound on 127.0.0.1.
     */
    host?: string;
    /**
     * Hostname to reach the server by. Default `mattermost.test` (or
     * `MATTERMOST_TEST_HOSTNAME`) — routed to 127.0.0.18 in the CI runners'
     * hosts file. Used only when it resolves to `host`; otherwise (a dev box
     * without the entry, GitHub-hosted runners) the URL falls back to `host`.
     */
    hostname?: string;
    /** Host port the app is published on. Default 8065 (or `MATTERMOST_TEST_PORT`). */
    port?: number;
    /** Overrides the image tag (default pinned in the compose file). */
    imageTag?: string;
    /** How long to wait for `/system/ping` to answer OK. Default 180 s. */
    timeoutMs?: number;
}

export interface RunningMattermost
{
    url: string;
    /** `docker compose down -v` for this project. */
    stop(): Promise<void>;
}

async function compose(projectName: string, env: NodeJS.ProcessEnv, args: Array<string>): Promise<void>
{
    await execFileAsync(
        "docker",
        ["compose", "-p", projectName, "-f", MATTERMOST_COMPOSE_FILE, ...args],
        { env: { ...process.env, ...env }, maxBuffer: 16 * 1024 * 1024 },
    );
}

/** Polls `/api/v4/system/ping` until Mattermost reports healthy. */
export async function waitForMattermost(url: string, timeoutMs = 180_000): Promise<void>
{
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;
    while (Date.now() < deadline)
    {
        try
        {
            const res = await fetch(`${url}/api/v4/system/ping`);
            if (res.ok) return;
            lastError = new Error(`ping -> ${res.status}`);
        }
        catch (error)
        {
            lastError = error;
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    throw new Error(`Mattermost at ${url} not ready after ${timeoutMs} ms: ${String(lastError)}`);
}

/** `hostname` if it resolves to `address`, else `address`. */
export async function resolveMattermostHost(hostname: string, address: string): Promise<string>
{
    try
    {
        const resolved = await lookup(hostname, { family: 4 });
        return resolved.address === address ? hostname : address;
    }
    catch
    {
        return address;
    }
}

/**
 * Starts the bundled Mattermost + Postgres compose project and waits until
 * the API answers. Needs `docker compose` on PATH.
 */
export async function startMattermost(options: StartMattermostOptions = {}): Promise<RunningMattermost>
{
    const projectName = options.projectName ?? "test-kit-mattermost";
    const host = options.host ?? process.env.MATTERMOST_TEST_HOST ?? "127.0.0.18";
    const port = options.port ?? Number(process.env.MATTERMOST_TEST_PORT ?? 8065);
    const siteHost = await resolveMattermostHost(
        options.hostname ?? process.env.MATTERMOST_TEST_HOSTNAME ?? "mattermost.test",
        host,
    );
    const env: NodeJS.ProcessEnv = {
        MATTERMOST_TEST_HOST: host,
        MATTERMOST_TEST_SITE_HOST: siteHost,
        MATTERMOST_TEST_PORT: String(port),
    };
    if (options.imageTag) env.MATTERMOST_IMAGE_TAG = options.imageTag;

    const stop = () => compose(projectName, env, ["down", "-v", "--remove-orphans"]);
    // A previous run killed mid-way would otherwise hand us a stale database.
    await stop();
    await compose(projectName, env, ["up", "-d"]);

    const url = `http://${siteHost}:${port}`;
    try
    {
        await waitForMattermost(url, options.timeoutMs);
    }
    catch (error)
    {
        await stop().catch(() => {});
        throw error;
    }
    return { url, stop };
}

// ── Fixture data ─────────────────────────────────────────────────────────────

export interface MattermostFixture
{
    url: string;
    admin: { id: string; username: string; password: string; token: string };
    team: { id: string; name: string };
    channel: { id: string; name: string };
    bot: { id: string; username: string; token: string };
}

export interface BootstrapMattermostOptions
{
    teamName?: string;
    channelName?: string;
    botUsername?: string;
}

/**
 * Seeds a fresh server: system admin (the first user created on an empty
 * server becomes one), a team, an open channel, and a bot with a personal
 * access token that is a member of both — the shape every app integration
 * (peek-a-boo, bluz) posts through.
 *
 * Idempotent against a server it already bootstrapped, so a dev can keep one
 * container running across test runs (see `MATTERMOST_TEST_URL`).
 */
export async function bootstrapMattermost(
    url: string,
    options: BootstrapMattermostOptions = {},
): Promise<MattermostFixture>
{
    const teamName = options.teamName ?? "test-team";
    const channelName = options.channelName ?? "test-channel";
    const botUsername = options.botUsername ?? "test-bot";
    const anon = new MattermostClient(url);

    // Once any user exists, signup is closed (403) — on a server we already
    // bootstrapped that just means the admin is there; login below confirms it.
    await anon.post("/users", MATTERMOST_ADMIN).catch((error: unknown) =>
    {
        if (error instanceof MattermostRequestError && error.status === 403) return undefined;
        return ignoreConflict(error);
    });

    const loginRes = await fetch(`${url}/api/v4/users/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login_id: MATTERMOST_ADMIN.username, password: MATTERMOST_ADMIN.password }),
    });
    const adminToken = loginRes.headers.get("Token");
    if (!loginRes.ok || !adminToken)
    {
        throw new Error(`Mattermost admin login failed (${loginRes.status}): ${await loginRes.text()}`);
    }
    const adminUser = (await loginRes.json()) as { id: string };
    const admin = new MattermostClient(url, adminToken);

    const team =
        (await admin.post<{ id: string }>("/teams", { name: teamName, display_name: teamName, type: "O" })
            .catch(ignoreConflict)) ??
        (await admin.request<{ id: string }>(`/teams/name/${teamName}`));

    const channel =
        (await admin.post<{ id: string }>("/channels", {
            team_id: team.id,
            name: channelName,
            display_name: channelName,
            type: "O",
        }).catch(ignoreConflict)) ??
        (await admin.request<{ id: string }>(`/teams/${team.id}/channels/name/${channelName}`));

    const bot =
        (await admin.post<{ user_id: string }>("/bots", { username: botUsername, display_name: botUsername })
            .catch(ignoreConflict)) ??
        { user_id: (await admin.request<{ id: string }>(`/users/username/${botUsername}`)).id };

    await admin.post(`/teams/${team.id}/members`, { team_id: team.id, user_id: bot.user_id });
    await admin.post(`/channels/${channel.id}/members`, { user_id: bot.user_id });

    const botToken = await admin.post<{ token: string }>(`/users/${bot.user_id}/tokens`, {
        description: "test-kit integration tests",
    });

    return {
        url,
        admin: {
            id: adminUser.id,
            username: MATTERMOST_ADMIN.username,
            password: MATTERMOST_ADMIN.password,
            token: adminToken,
        },
        team: { id: team.id, name: teamName },
        channel: { id: channel.id, name: channelName },
        bot: { id: bot.user_id, username: botUsername, token: botToken.token },
    };
}

/** Mattermost answers "already exists" with 400 or 409 depending on the endpoint. */
function ignoreConflict(error: unknown): undefined
{
    if (
        error instanceof MattermostRequestError &&
        (error.status === 409 || (error.status === 400 && /exist|taken/i.test(error.body)))
    )
    {
        return undefined;
    }
    throw error;
}

// ── One-call setup for a test runner's globalSetup ───────────────────────────

export interface SetupMattermostOptions extends StartMattermostOptions, BootstrapMattermostOptions {}

/**
 * Start (unless `MATTERMOST_TEST_URL` points at one already running) and
 * bootstrap a Mattermost, returning the fixture and a teardown. Built for a
 * Vitest `globalSetup` / Playwright `globalSetup`:
 *
 * ```ts
 * export default async function ({ provide }) {
 *     const { fixture, teardown } = await setupMattermost();
 *     provide("mattermost", fixture);
 *     return teardown;
 * }
 * ```
 *
 * Set `MATTERMOST_TEST_KEEP=1` to leave the containers up after the run.
 */
export async function setupMattermost(
    options: SetupMattermostOptions = {},
): Promise<{ fixture: MattermostFixture; teardown: () => Promise<void> }>
{
    const externalUrl = process.env.MATTERMOST_TEST_URL;
    let running: RunningMattermost | undefined;
    let url: string;
    if (externalUrl)
    {
        url = externalUrl.replace(/\/+$/, "");
        await waitForMattermost(url, options.timeoutMs);
    }
    else
    {
        running = await startMattermost(options);
        url = running.url;
    }

    try
    {
        const fixture = await bootstrapMattermost(url, options);
        const keep = !!process.env.MATTERMOST_TEST_KEEP;
        return { fixture, teardown: async () => { if (running && !keep) await running.stop(); } };
    }
    catch (error)
    {
        await running?.stop().catch(() => {});
        throw error;
    }
}
