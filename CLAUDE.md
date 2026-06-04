# Working in this repo

This is an **immediately.run app**: React + TypeScript that loads from GitHub and
transpiles in the browser (no server, no build step at runtime). Keep the rules
below or the app breaks *only* on immediately.run while still looking fine in
local `vite dev` — the most common silent failure.

## Hard rules (these break immediately.run if violated)

1. **`src/App.tsx` is the entry point.** immediately.run renders its **default
   export**. `src/main.tsx` is for local dev/build only and is **ignored** at
   runtime — never put CSS imports, providers, or app logic there.
2. **Import global CSS from `App.tsx`**, not from `main.tsx`. Anything the
   rendered tree needs (CSS, context providers) must be reachable from
   `App.tsx`.
3. **A file that exports a React component exports ONLY components.** No mixing a
   component with named exports of data/constants/helpers. (`interface`/`type`
   are erased at compile time and are fine.) This is the React Fast Refresh rule;
   `npm run lint` enforces it. Put data in `src/data/`, hooks in `src/hooks/`,
   utilities in `src/lib/`.
4. **One component per file, default-exported**, named for what it renders.
5. **CSS lives in `.css` files imported from TypeScript** — not in giant
   `<style>` blocks or inline `style={{}}` for the bulk of styling.
6. **Fonts via CSS `@import`** as the first line of the CSS file, not `<link>`
   tags in `index.html`.
7. **Import local assets** (`import logo from './assets/logo.png'`); don't
   reference server paths that won't exist in the sandbox.
8. **No Node / build-time-only APIs** in the rendered tree — it runs in a browser
   iframe. `localStorage`, `document`, `window`, and `fetch` are available.
9. **MDX is only for long-form prose** (articles, guides). Structured/repeated
   data stays as typed arrays in `src/data/`. If you add `.mdx`, the Vite plugin
   and `src/mdx.d.ts` shim are already wired up.

## Loading & caching on immediately.run

`.github/workflows/cache.yml` publishes a pre-cached zip of this repo to its own
GitHub Pages on each push to `main`, so immediately.run loads fast and within
anonymous rate limits. It needs Pages **Source: GitHub Actions** enabled once in
repo settings. Don't move the cache to a different path or hostname — the client
discovers it by convention at
`https://<owner>.github.io/<repo>/cached_repositories/main.zip`.

`"immediately.run": { "requireLatest": "..." }` in `package.json` controls
freshness. It is a **string enum**, not a boolean: `"stale_ok"` (always serve
the cache, fastest, offline-friendly), `"optimistic"` (the default — serve
cache, check in background), or `"strict"` (always run the newest commit, at
the cost of a freshness check on launch). Leave it unset unless
to-the-commit freshness matters; the default is fast and works offline.

## Design system

This brand is: cool near-black canvas · magenta↔violet signature gradient ·
Gabarito display type · Space Mono details · hairline borders · hard-offset hover
shadows · sentence case · headlines end on a period · **no emoji**. Dark is the
default; a light theme is wired via `data-theme="light"` on `<html>`.

- **Pull tokens from `src/index.css`** (`--bg`, `--panel`, `--ink`, `--accent`,
  `--grad`, `--r-lg`, `--shadow-card`, the type families, etc.) instead of
  hard-coding colors, radii, or fonts.
- Apply the signature gradient to text with `className="grad-text"`.
- For icons beyond the unicode set (`→ ★ ● ☀ ☾`), use
  [Lucide](https://lucide.dev) at 16–24px, `currentColor`. No emoji.

## Platform security model (what your app can and can't do)

Your app runs in a **sandboxed iframe with an opaque origin**. The rules below
follow from that and from the platform capability model
(`docs/specs/UI_AS_APPS_SPEC.md` §8 in the docs repo). Violations don't just
break your app — calls fail with typed errors, and trying to work around them
reads as hostile. (Enforcement is rolling out per the spec's §10 ladder —
items 4, 6 and 8 describe machinery that is specified but not yet live; write
new code as if they're enforced and it will keep working as they land.)

1. **All platform interaction goes through `@immediately-run/sdk`.** There is
   no other channel: no shared storage with other apps, no reaching sibling
   iframes, no postMessage of your own to the parent.
2. **Never handle user credentials.** You will never see the user's GitHub
   token, API keys, or any secret — sign-in and privileged actions are
   host-driven. Call protocol methods reactively, gated on
   `getAuthState().status === 'signed-in'`; never store or request tokens.
3. **The filesystem you see is the filesystem you got.** Mounts the host gives
   you (your app's spaces, granted folders) are your whole world — outside
   paths don't exist, and a grant may be read-only. Don't probe for escapes
   (`..`, absolute paths); writes to read-only mounts fail with `EROFS`.
4. **Access to more data is asked for, not taken.** Need another space or
   folder? Call the SDK request method and the *user* picks in host UI. Expect
   `{ ok: false, code: 'cancelled' | 'forbidden' }` and handle it gracefully.
5. **Handle typed errors everywhere.** Platform calls reply
   `{ ok: false, code, message }` (`forbidden`, `auth-required`, `cancelled`,
   `invalid-params`, …). `forbidden` means your app lacks that capability —
   that's policy, not a bug to retry around.
6. **Declare what you invoke and provide.** Cross-app tasks go in
   `package.json` under `"immediately.run"`: `"invokes"` for task contracts
   you call, `"provides"` for ones you implement. Undeclared invocations are
   rejected.
7. **Don't imitate host chrome.** Never render fake sign-in prompts, consent
   dialogs, or the platform's seam/header UI. The host draws those; imitations
   are treated as spoofing.
8. **If you embed an LLM agent, its tool list is your catalog.** Use the
   SDK-provided method catalog as the agent's tools — it is pre-filtered to
   your app's grants, so the agent can't exceed what your app may do. Don't
   hand-roll tools that shell around the SDK.
9. **Expect cancellation and absence.** Interactive flows can resolve
   `cancelled`; capabilities can be absent on a fork of your app. Degrade
   features, don't crash.

## Verify before you're done

```bash
npm run build   # must pass with no type errors
npm run lint    # must pass — this is the cheapest proof the Fast Refresh rule holds
```

Then eyeball the page (`npm run dev`) and click any interactive controls.
