import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import mdx from '@mdx-js/rollup'

// MDX must run before @vitejs/plugin-react so the JSX it emits is handled by
// React's transform (Fast Refresh included). immediately.run processes .mdx
// natively; this wiring keeps the local `vite dev`/`build` in sync.
// https://vite.dev/config/
export default defineConfig({
  plugins: [
    { enforce: 'pre', ...mdx() },
    react(),
  ],
})
