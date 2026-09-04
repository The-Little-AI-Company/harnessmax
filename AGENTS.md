# HarnessMax

The console for governed agent workspaces. Working name. Read this file
before changing anything, whether you are a person or an agent.

## What this is

A local-first console that reads a workspace folder, indexes it, shows its
memory, gates, receipts, and fleet board, and never moves a file without a
receipt. The engine is Vivary. The UI is React with shadcn/ui on Tailwind
v4. The index is PGlite. The desktop shell is Tauri 2. Plans, research, and
the design law live in a private planning repository. This repository holds
code, tests, and the public backlog.

## The backlog

GitHub Issues in this repository, one system, nothing else. Each issue
carries a goal, the context an agent needs, a done condition a reviewer can
check, and a verify block that proves it. Labels are the state:

| Label | Meaning |
|---|---|
| `needs-triage` | Filed, not yet shaped |
| `needs-info` | Waiting on a fact from a person |
| `ready-for-agent` | Shaped, unblocked, one session of work |
| `ready-for-human` | Only a person with the right access can do it |
| `in-progress` | Someone took it. Comment when you start |
| `wontfix` | Closed without doing it, with a reason |

"Blocked by #N" in an issue body means what it says. Take the
lowest-numbered `ready-for-agent` issue with no open blockers, comment that
you started, do the work, run the verify block, and close it with the
verify output in the closing comment. Then edit the issues it unblocks.

## Branches

`dev` is the default working branch. `feature/*` branches merge into `dev`
by pull request. `prod` is for releases. One issue per branch, one pull
request per issue, atomic commits.

## Toolchain

- Node 22 and pnpm. Never npm. `pnpm install --frozen-lockfile` in CI.
- TypeScript everywhere. Vite for the build. React. shadcn/ui on Tailwind v4.
- PGlite for the index. Tauri 2 for the desktop shell.
- Python 3.11 or newer for the Vivary engine, run through `uvx`.
- Secrets go through `varlock run -- <command>` with a committed
  `.env.schema`. No secret is ever committed, echoed, or pasted into an
  issue.

## Design tokens

The design tokens live in `src/styles/tokens.css` and nowhere else. Four
themes share one identity: Signal, Paper, Calm, and Contrast. Before any
color change ships, run:

```bash
node scripts/contrast-check.mjs src/styles/tokens.css
```

It computes WCAG 2.2 contrast for every text, link, rule, and focus pair in
every theme and exits 1 on the first failure. Rules that hold everywhere: no
`box-shadow`, no gradient, no motion the reader did not cause, radius 4px on
controls and 0 on panels, sentence case everywhere, no icons, no
AI-generated images.

## Sandboxing

Development happens inside a container. The repository ships a devcontainer
and CI runs in it. Code the console executes on a user's behalf runs in a
sandbox tier the user can see, and every execution leaves a receipt.

## Writing

Sentence case headings. Short sentences. Second person. No em dashes, no
marketing adjectives, no claim without a source or a verified date. Commit
messages say what changed and why in plain words.

## Boundaries

Nothing here publishes, deploys, sends, or spends without the maintainer's
explicit approval. Agents open pull requests. People merge them.
