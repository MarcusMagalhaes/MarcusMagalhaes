/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// base: o Cloudflare publica na raiz do domínio. VITE_BASE só se o site for servido num subcaminho.
export default defineConfig(({ command, mode }) => {
  // build sem o .env gera um site que abre em "Banco não configurado" (lição do Luminexus 1.0.093): recusa o build
  if (command === 'build') {
    const env = loadEnv(mode, process.cwd(), 'VITE_')
    const faltam = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'].filter((k) => !env[k] && !process.env[k])
    if (faltam.length) throw new Error(`Build sem ${faltam.join(' e ')}: crie o .env a partir do .env.example antes de publicar.`)
  }
  return {
    plugins: [react()],
    base: process.env.VITE_BASE ?? '/',
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: { port: 5175 },
  }
})
