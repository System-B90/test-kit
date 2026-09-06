import { configDefaults, defineConfig, type UserConfig } from "vitest/config";

/**
 * Shared Vitest exclusions, factored out of bluz/madash/peek-a-boo's
 * near-identical `tests/vitest.config.ts` files (System-B90/Bluz#226).
 */
export const VITEST_SHARED_EXCLUDE: Array<string> = [
    ...configDefaults.exclude,
    "**/.claude/**",
    "**/worktrees/**",
];

type VitestTestOptions = NonNullable<UserConfig["test"]>;

export interface DefineSharedVitestConfigOptions
{
    /** Passed straight through to Vitest's `test.root`. */
    root?: string;
    /** Passed straight through to Vitest's `test.include`. */
    include?: VitestTestOptions["include"];
    /** Passed straight through to Vitest's `test.setupFiles`. */
    setupFiles?: VitestTestOptions["setupFiles"];
    /** Passed straight through to Vitest's `test.alias`. */
    alias?: VitestTestOptions["alias"];
    /** Any other `test`-level fields a caller needs (env, maxForks, server, …). */
    test?: Omit<VitestTestOptions, "include" | "setupFiles" | "alias" | "root">;
    /** Any other top-level Vite/Vitest config fields (e.g. `resolve`, `plugins`). */
    config?: Omit<UserConfig, "test">;
}

/**
 * Merges caller `options` over the shared Vitest defaults:
 * - `resolve: { tsconfigPaths: true }` — Vite 8 resolves tsconfig `paths`
 *   natively, so the `vite-tsconfig-paths` plugin (and its unmaintained
 *   `tsconfck` dependency) is unnecessary. See vitest/vitest#380.
 * - `environment: "node"`
 * - `exclude`: `configDefaults.exclude` plus `.claude` and `worktrees`.
 *
 * Callers pass `root`/`include`/`setupFiles`/`alias` directly; anything else
 * goes in `test` (other `test`-level fields) or `config` (other top-level
 * fields such as `resolve`/`plugins`, merged after the shared `resolve`).
 */
export function defineSharedVitestConfig(
    options: DefineSharedVitestConfigOptions = {},
): ReturnType<typeof defineConfig>
{
    const { root, include, setupFiles, alias, test, config } = options;

    return defineConfig({
        // Cast: this vitest/vite version's shipped types don't yet declare
        // `resolve.tsconfigPaths` (added for native tsconfig `paths`
        // resolution, replacing the `vite-tsconfig-paths` plugin and its
        // deprecated `tsconfck` dependency — see vitest-dev/vitest#380).
        // Consumers on a newer vite get full type-checking on this field;
        // this package only forwards the value.
        resolve: { tsconfigPaths: true } as UserConfig["resolve"],
        ...config,
        test: {
            environment: "node",
            exclude: VITEST_SHARED_EXCLUDE,
            ...(root !== undefined ? { root } : {}),
            ...(include !== undefined ? { include } : {}),
            ...(setupFiles !== undefined ? { setupFiles } : {}),
            ...(alias !== undefined ? { alias } : {}),
            ...test,
        },
    });
}
