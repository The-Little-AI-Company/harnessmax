---
name: browserpod
description: This skill should be used when the user asks to "run this in a pod", "boot a BrowserPod", "run the agent inside the sandbox", "add the sandbox tier", "write files into the pod", "capture pod output", or touches anything under the console's execution boundary. It holds the BrowserPod facts that decide how code is written here: boot options, the run and terminal contract, persistence, headers, the token cost, the terms, and the receipt wrapper.
---

# BrowserPod, the sandbox agents run inside

A pod is a WebAssembly runtime in a browser tab with Node 22, bash, git,
and a Rust toolchain. Nothing in a pod can reach the host disk. Files live
in the pod's own filesystem, persisted in IndexedDB per origin when the pod
boots with a `storageKey`. This is the execution boundary for every agent
action in HarnessMax, and the sandbox the product is built inside where a
pod can do the job. The facts below were read from the vendor docs on
2026-09-04. `references/api.md` holds the signatures and the error table.
`references/terms-email.md` holds the terms question for the vendor.

## Rules that never bend

- Each user brings their own key. Never ship a key in the bundle. The
  console reads `BROWSERPOD_API_KEY` from `.env.local` through
  `varlock run --` in development and from the user's settings in the app.
  The vendor's own docs say the key "will ultimately be available to the
  client," so treat it as the user's, not ours.
- Every `pod.run` goes through the receipt wrapper (`runWithReceipt`, owned
  by the receipts module). No direct `pod.run` outside it. The wrapper
  writes the receipt row before returning the result.
- A boot costs 10 tokens and each hour costs 10 more. Boot once per
  workspace session, reuse the pod, and stop it when the user leaves the
  workspace. Never boot in a loop, never boot in a test that runs in CI.
- The page that boots a pod must send `Cross-Origin-Opener-Policy:
  same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. Vite dev
  config sets both. Without them boot fails on `SharedArrayBuffer`.
- Files of record stay on the user's disk. The console copies the
  workspace into the pod at boot and copies changes out through the receipt
  function. The pod's filesystem is a working copy, never the truth.
- Show the BrowserPod attribution (a visible link and the logo) in the
  sandbox tier panel while the user is on a Personal key. The terms require
  it. It is the one third-party mark the design law admits, and it appears
  there only.

## How to do the common things

### Boot

```ts
import { BrowserPod } from "browserpod";
const pod = await BrowserPod.boot({ apiKey, nodeVersion: "22", storageKey: workspaceId });
```

`storageKey` ties the pod's disk to the workspace, so a reload resumes the
same files. Omit it only for a throwaway.

### Run a command and capture its output

`pod.run` is `execve`, not a shell. No `&&`, no pipes, no globs. Write the
logic as a script file in the pod and run `node` or `bash` on it. Output
arrives only through a Terminal. Create a headless one:

```ts
const chunks: Uint8Array[] = [];
const terminal = await pod.createCustomTerminal({
  onOutput: (buf) => chunks.push(new Uint8Array(buf)),
});
await pod.run("bash", ["/workspace/.harness/run.sh"], { terminal, cwd: "/workspace", env: ["CI=1"] });
```

`Process` exposes no exit code. The run script must print a sentinel
line, `__harness_exit:<code>__`, as its last output, and the wrapper parses
the captured bytes for it. Keep the terminal element mounted for the whole
run, or output stops.

### Write and read files

```ts
await pod.createDirectory("/workspace/memory", { recursive: true });
const f = await pod.createFile("/workspace/memory/index.md", "utf-8");
await f.write(text);
await f.close();
```

Modes are `"utf-8"` and `"binary"` only. Read with `openFile` then
`read()`.

### Install dependencies inside the pod

`npm install` works from inside a pod. Native binaries do not. Before
installing anything with a prebuilt binary, add the Wasm override in the
pod's `package.json` (`esbuild` to `esbuild-wasm`, `rollup` to
`@rollup/wasm-node`). A failing install inside a pod is usually this.

### Expose a server

A process listening on a port inside the pod gets a public Portal URL
through `pod.onPortal(({ url, port }) => ...)`. Portal traffic passes
through the vendor. Use it for previews the user asked for, never by
default.

## Before the first real use

Run the spike in `benchmarks/browserpod/` (issue on the frontier) and
record boot time, tab memory, build time, whether `claude -p` and
`codex exec` answer from inside the pod, whether the disk survives a
reload, and tokens spent. Nothing in the console depends on a pod until
`RESULTS.md` exists.

## What this skill does not cover

Habitat, the WSL2 sandbox for the Tauri build and for anything a pod cannot
run. The MCP server. The receipt schema itself, which lives with the
receipts module.
