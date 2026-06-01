# immediately.run — starter template

A ready-to-run starter for building apps on
[immediately.run](https://immediately.run): React + TypeScript + Vite, wired to
the brand design system, with the project layout immediately.run expects.

## Try it instantly

Try this template on [immediately.run](https://immediately.run/present/github/immediately-run/new-project-template/main/files/src/App.tsx)

> Using this as a starting point for your own app? After you push to your repo,
> update the link above to
> `https://immediately.run/present/github/<owner>/<repo>/<ref>/files/src/App.tsx`.

## Use this template

1. Create a new repo from this template (or copy the files).
2. `npm install`
3. `npm run dev` and start editing `src/App.tsx`.
4. Push to GitHub and open it on immediately.run with the link above.

## How it's organized

immediately.run renders the **default export of `src/App.tsx`** — that's the
entry point, not `main.tsx`.

```
src/
  main.tsx              # local vite dev/build entry only — immediately.run IGNORES this
  App.tsx               # ROOT: default export + imports the global CSS
  index.css             # fonts, design tokens (dark + light), resets
  App.css               # layout + component styles
  mdx.d.ts              # type shim so `import X from './x.mdx'` works
  components/           # one default-exported React component per file
  data/                 # typed data arrays (NO components/JSX here)
  hooks/                # custom hooks (NO components here)
  assets/               # images you import, e.g. import logo from './assets/logo.png'
```

The included page shows the core patterns: a data array mapped to cards
(`data/features.ts` → `components/Features.tsx`), a custom hook
(`hooks/useTheme.ts` → `components/ThemeSwitch.tsx`), and local React state
(`components/Counter.tsx`).

## The rules that keep it working on immediately.run

See [`CLAUDE.md`](./CLAUDE.md) for the full list. The essentials:

- **Global CSS is imported from `App.tsx`, never only from `main.tsx`.**
- **A file that exports a component exports *only* components** — data, consts,
  and helpers go in `data/`, `hooks/`, or `lib/`. `npm run lint` enforces this.
- **Pull colors, fonts, radii, and shadows from the tokens in `index.css`**
  rather than hard-coding values.

## Develop

Requires Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev      # local dev server
npm run build    # tsc -b && vite build — must pass with no type errors
npm run lint     # eslint — enforces the React Fast Refresh / HMR rule
npm run preview  # serve the production build
```
