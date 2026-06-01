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

## Verify before you're done

```bash
npm run build   # must pass with no type errors
npm run lint    # must pass — this is the cheapest proof the Fast Refresh rule holds
```

Then eyeball the page (`npm run dev`) and click any interactive controls.
