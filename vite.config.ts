import { defineConfig } from 'vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'

// SPA mode: all data lives in the browser (IndexedDB / localStorage), so there is nothing to
// render on a server. The build prerenders a static shell as /index.html and the app renders client-side.
const config = defineConfig({
  resolve: { tsconfigPaths: true },
  // The prerender step fetches the shell from a preview server at 127.0.0.1; without an explicit IPv4 host the
  // server can listen on ::1 only (Linux containers, CI) and the build fails with ECONNREFUSED.
  preview: { host: '127.0.0.1' },
  // Neon Auth is reached through /auth on the app's own origin (vercel.json rewrites it in production), so its
  // session cookies are first-party: Safari blocks third-party ones. Same path in development.
  server: process.env.VITE_NEON_AUTH_URL
    ? { proxy: { '/auth': { target: process.env.VITE_NEON_AUTH_URL.replace(/\/neondb\/auth\/?$/, ''), changeOrigin: true, rewrite: (p: string) => p.replace(/^\/auth/, '/neondb/auth') } } }
    : {},
  plugins: [
    tanstackStart({ spa: { enabled: true, prerender: { outputPath: '/index.html' } } }),
    viteReact(),
  ],
})

export default config
