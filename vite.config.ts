import { defineConfig } from 'vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'

// SPA mode: all data lives in the browser (IndexedDB / localStorage), so there is nothing to
// render on a server. The build prerenders a static shell as /index.html and the app renders client-side.
const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    tanstackStart({ spa: { enabled: true, prerender: { outputPath: '/index.html' } } }),
    viteReact(),
  ],
})

export default config
