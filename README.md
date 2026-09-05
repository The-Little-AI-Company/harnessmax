# HarnessMax

Working name. The console for governed agent workspaces.

Your agents already do the work. Claude Code, Codex, and Letta Code keep
doing it. This is the folder they do it in: memory as files you can read
and diff, rules for what an agent may touch, a receipt for everything it
did, a sandbox tier you chose, and a board for running several agents on
one project without them overwriting each other. Everything lives on your
machine. Better models read that folder better, so the product gains value
as models improve.

## Status

Planning. Development starts with the console shell and a
storage benchmark, and the first public alpha is the goal of the current
appetite. Watch the issue tracker.

## Engine

The engine is [Vivary](https://github.com/vivary-dev/vivary): typed context
over plain files, task capsules, receipts, human gates, and a coordination
board. Starter workspaces come from the Agent Workspace Catalog. Long-term
memory is Markdown in git. The index is PGlite, Postgres in WebAssembly,
and it rebuilds from the files at any time.

## Working here

Read `AGENTS.md`. The backlog is GitHub Issues in this repository. Labels
carry the state, and `ready-for-agent` marks work a person or an agent can
pick up without reading anything else.

## License

MIT. See `LICENSE`.
