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

## Branches and commits

`dev` is the default working branch. `prod` is the release branch and only
receives merges from `dev`. Work happens on a branch named for its kind and
its subject: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `docs/<slug>`,
`refactor/<slug>`, `ci/<slug>`, `test/<slug>`, `perf/<slug>`. One issue per
branch, one pull request per issue.

Commits are atomic. One commit is one change a reviewer can read on its own
and revert on its own: a type plus its tests, one fix, one rename. A commit
that needs "and" in its subject is two commits. Never squash on merge, since
that erases the atomic history. Rebase onto `dev` instead of merging `dev`
in. The subject is a capitalized sentence under 72 characters with no
trailing period, and the body says why.

`node scripts/check-git.mjs --branch <name>` and
`node scripts/check-git.mjs --range origin/dev..HEAD` run in CI on every
pull request and fail on a bad name, a merge commit, a throwaway subject, or
an em dash.

## Code review rules

Codex reviews every pull request into `dev` twice over. The Codex cloud
integration, on the maintainer's subscription, reviews every pull request
and posts its findings. `.github/workflows/codex-review.yml` runs the deep
review in CI, at high effort and scoped to the pull request's diff, only
when the pull request crosses a breakpoint. `scripts/detect-breakpoint.mjs`
decides that from the changed paths against `.github/codex/breakpoints.txt`,
and the `deep-review` label forces it. The deep review runs on the
maintainer's Codex subscription through the `codex-review` environment,
whose secret is reachable only after its environment approval, and
it warns when the login refreshed so the secret gets re-uploaded. Both
follow `.github/codex/review-prompt.md` and this section. Every finding blocks
the merge. The author fixes it, or replies with the reason and a
maintainer dismisses it. A finding is a defect with a file, a line, and a
fix, never a preference.

Reviewers, human or model, check these in order:

1. No secret, token, or key in the diff or in a test fixture.
2. Every write to a user's file goes through the one receipt-writing
   function. No second write path.
3. Anything that executes runs in a sandbox tier the user can see.
4. The design tokens hold: no `box-shadow`, no gradient, no motion the
   reader did not cause, radius 4px on controls and 0 on panels, sentence
   case, an icon only beside a word.
5. pnpm only, every dependency pinned exactly and listed in
   `DEPENDENCIES.md`.
6. The issue's Verify block ran and its output is in the pull request.
7. The change is the smallest one that solves the problem. No layer, wrapper,
   or option that has one caller.

A breakpoint is any change under the paths in
`.github/codex/breakpoints.txt`: the receipt write path, the pod runtime,
the agent surface and gates, the workspace contract and folder interface,
the MCP server, the Tauri shell, CI, scripts, and the dependency files.
A maintainer also runs an adversarial multi-model review on those before
merge. Add a path to the list in the same pull request that creates a new
boundary. A pull request runs the workflow from its own merge ref, so it
could edit the detector or the workflow to hide itself. Changes under
`.github/` or to the detector force the deep review regardless of the
list, and a maintainer reads every pull request that touches `.github/`
before merging it.

## Dependencies

`DEPENDENCIES.md` is the ledger. A package enters `package.json` and the
ledger in the same commit, pinned exactly, after the dependency gate in the
security-audit skill has run. `node scripts/check-deps-ledger.mjs` fails CI
on drift or a floating version. Before adding a package, say what it does
that twenty lines of project code cannot.

## Toolchain

- Node 22 and pnpm. Never npm. `pnpm install --frozen-lockfile` in CI.
- TypeScript everywhere. Vite for the build. React. shadcn/ui on Tailwind v4.
- PGlite for the index. Tauri 2 for the desktop shell.
- Python 3.11 or newer for the Vivary engine, run through `uvx`.
- Secrets go through `varlock run -- <command>` with a committed
  `.env.schema`. No secret is ever committed, echoed, or pasted into an
  issue.

## Design tokens

The design tokens live in `src/styles/tokens/` and nowhere else:
`colors.css` for the four themes, `typography.css`, `spacing.css`,
`display-settings.css`, `fonts.css`, and `base.css` for element defaults and
the structural classes. `src/styles/index.css` imports them in that order.
Four themes share one identity: Signal, Paper, Calm, and Contrast. Before
any color change ships, run:

```bash
node scripts/contrast-check.mjs src/styles/tokens/colors.css
```

It computes WCAG 2.2 contrast for every text, link, rule, and focus pair in
every theme and exits 1 on the first failure. Rules that hold everywhere: no
`box-shadow`, no gradient, no motion the reader did not cause, radius 4px on
controls and 0 on panels, sentence case everywhere, Lucide icons only and
always beside a word, no AI-generated images.

## Sandboxing

Development happens inside a container. `.devcontainer/devcontainer.json`
describes it, and CI runs the same checks on a bare runner
(`.github/workflows/ci.yml`). Code the console executes on a user's behalf
runs in a sandbox tier the user can see, and every execution leaves a
receipt.

## Skills

Project skills live in `.agents/skills/` and are the procedures agents
follow here. Read the matching one before the work: `browserpod` for
anything that touches the sandbox tier, `here-now` (a shared skill) for
publishing a static site.

## Writing

Sentence case headings. Short sentences. Second person. No em dashes, no
marketing adjectives, no claim without a source or a verified date. Commit
messages say what changed and why in plain words.

## Boundaries

Jeff grants standing authorization for the selected issue's commits,
pushes, PR creation and updates, scoped backlog maintenance, review fixes,
and approval of same-repository review runs after the orchestrator inspects
the exact workflow and SHA. Do not ask for each commit or review. Finish
the review/fix loop, then bring the verified PR to Jeff for merge approval.
This does not authorize unrelated/fork review runs, deployments, spending,
credential changes, unrelated external messages, or destruction of others'
work. Agents prepare and review pull requests. Jeff approves their merge.
