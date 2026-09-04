# BrowserPod API notes

Read from https://browserpod.io/docs on 2026-09-04. Package `browserpod`
3.0.1 on npm, also published as `@leaningtech/browserpod`. The package is a
21 KB loader and the runtime downloads at boot.

The license is proprietary ("SEE LICENSE IN LICENSE.txt"). The Terms of
Service (https://browserpod.io/browserpod-tos), the Pricing Policy
(https://browserpod.io/browserpod-pricing-policy), and the Privacy Policy
govern use.

## Signatures

```ts
BrowserPod.boot(opts: {
  apiKey: string;
  nodeVersion?: string;   // only "22"
  storageKey?: string;    // persistent disk id; omitted = fresh disk
  userImage?: string;     // URL of an ext2 image mounted on /home
}): Promise<BrowserPod>

pod.run(executable: string, args: string[], opts: {
  terminal: Terminal;
  env?: string[];         // "KEY=value"
  cwd?: string;
  echo?: boolean;
}): Promise<Process>      // resolves when the process exits; Process is opaque

pod.createCustomTerminal(opts: {
  cols?: number; rows?: number;
  onOutput: (buffer: ArrayBuffer, vt?: unknown) => void;
}): Promise<Terminal>
pod.createDefaultTerminal(...)   // xterm.js based

pod.createDirectory(path: string, opts?: { recursive?: boolean }): Promise<void>
pod.createFile(path: string, mode: "utf-8" | "binary"): Promise<TextFile | BinaryFile>
pod.openFile(path: string, mode: "utf-8" | "binary"): Promise<TextFile | BinaryFile>
file.write(data) / file.read() / file.getSize() / file.close()

pod.onOpen(cb)
pod.onPortal(({ url, port }) => void)
```

Sources: https://browserpod.io/docs/reference/BrowserPod/boot,
https://browserpod.io/docs/reference/BrowserPod/run,
https://browserpod.io/docs/reference/BrowserPod/createCustomTerminal,
https://browserpod.io/docs/guides/write-files-to-pod,
https://browserpod.io/docs/understanding-browserpod/portals.

## Facts that shape code

| Fact | Consequence | Source |
|---|---|---|
| Boot deducts 10 tokens, each hour 10 more. Free plan 10,000 tokens a month | One pod per workspace session, stopped on leave | https://browserpod.io/browserpod-pricing-policy |
| Filesystem persists in IndexedDB, per origin, with `storageKey` | Same origin plus same key resumes the disk. Different origin, different disk | https://browserpod.io/docs/understanding-browserpod/filesystem |
| No host disk access | Copy in at boot, copy out through receipts | https://browserpod.io/docs/more/FAQ |
| `run` is `execve`, no shell features | Scripts, not command strings | https://browserpod.io/docs/guides/common-errors |
| No exit code on `Process` | Sentinel line parsed from terminal bytes | https://browserpod.io/docs/reference/Process |
| Terminal element must stay mounted | Hide with CSS, never unmount mid-run | https://browserpod.io/docs/guides/common-errors |
| COOP `same-origin` and COEP `require-corp` required, HTTPS in production, localhost exempt | Vite dev headers, and an open question for Tauri's WebView2 | https://browserpod.io/docs/understanding-browserpod/cross-origin-isolation |
| Native npm binaries fail | `overrides` to Wasm builds | https://browserpod.io/docs/guides/working-around-native-npm-dependencies |
| `npm install` works inside a pod | Registry access exists | https://browserpod.io/docs/getting-started/expressjs |
| Node 22, bash, git, Rust. Python, Ruby, Go planned | No Python at runtime | https://browserpod.io/docs/more/FAQ, changelog |
| Chrome, Edge, Firefox, Safari supported | | https://browserpod.io/docs/more/FAQ |

## Terms, verbatim where it matters

Personal plan: "The license covers strictly non-commercial purposes, as
well as technical evaluation, and does not allow resale or further
distribution." "Applications must clearly display an attribution, including
a visible link to our site and a logo of BrowserPod." Pro plan: "The
license covers commercial purposes." Effective 2025-11-13, Leaning
Technologies Limited. https://browserpod.io/browserpod-tos

## Errors

| Error | Cause | Fix |
|---|---|---|
| Boot fails, `SharedArrayBuffer` undefined | Missing COOP or COEP header, or http off localhost | Set both headers, serve over https or localhost |
| `The 'terminal' argument is required` | No terminal passed to `run` | Create one, keep it mounted |
| `Unsupported 'mode' argument` | Mode not `"binary"` or `"utf-8"` | Use one of the two |
| Install or runtime crash for esbuild, rollup | Native binary | `overrides` to the Wasm package |
| Output stops mid-run | Terminal element unmounted | Hide with CSS instead |
