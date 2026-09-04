# Dependencies

The ledger. Every package in `package.json` has a row here.
`node scripts/check-deps-ledger.mjs` fails CI when the two drift or when a
version is not pinned exactly.

Add the row in the same commit as the install, after the dependency gate in
the security-audit skill passes. The gate reads the package name from the
docs rather than from memory, requires either 72 hours since publish or a
provenance attestation, and rejects install scripts that do more than select
a platform binary.

The budget is containment. Before adding a package, say what it does that
twenty lines of project code cannot. Runtime dependencies stay within the
stack the plan of record names. Dev dependencies stay within checks that run
in CI.

## Installed

| Package | Kind | Purpose | License | Gate passed |
|---|---|---|---|---|

No packages yet. The scaffold in issue #4 adds the first rows.

## Planned, by issue

Not installed. Listed so the budget is visible before the first install.

| Package | Issue | Purpose | License |
|---|---|---|---|
| `react`, `react-dom` | #4 | UI | MIT |
| `vite`, `@vitejs/plugin-react` | #4 | Build | MIT |
| `typescript` | #4 | Types | Apache-2.0 |
| `tailwindcss`, `@tailwindcss/vite` | #4 | Styling for shadcn/ui | MIT |
| `shadcn` (CLI, dev) | #4 | Component source, vendored into the repo | MIT |
| `lucide-react` | #17 | The icon subset, vendored | ISC |
| `@shadscan/cli` (dev) | #4 | Component rule check in CI | MIT |
| `@electric-sql/pglite` | #3, #6 | The index and state store | Apache-2.0 |
| `@electric-sql/pglite-pgvector` | #6 | Vector search, off by default | Apache-2.0 |
| `@tauri-apps/api`, `@tauri-apps/cli` (dev) | #13 | Desktop shell | Apache-2.0 or MIT |

## CI tools

Run in CI through `pnpm dlx` at an exact version, never installed in the
repository. The check script does not compare these with `package.json`.

| Package | Version | Purpose | License | Gate passed |
|---|---|---|---|---|
| `@openai/codex` | 0.153.2 | The deep review in `codex-review.yml` | Apache-2.0 | 2026-09-04, SLSA provenance on npm, no install scripts, platform binaries as optional dependencies |

GitHub Actions carry a full commit SHA in the workflow that uses them, and
the dev container image carries its tag in `.devcontainer/devcontainer.json`.
This ledger does not repeat them.
