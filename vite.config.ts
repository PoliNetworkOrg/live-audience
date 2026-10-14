import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const server = `http://localhost:${process.env.PORT ?? 8787}`

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist/client" },
  server: {
    // Let the API proxy apply its own CORS policy, including file:// presentations.
    cors: { preflightContinue: true },
    port: Number(process.env.CLIENT_PORT ?? 5173),
    strictPort: true,
    proxy: { "/api": server, "/auth": server, "/healthz": server },
  },
})
