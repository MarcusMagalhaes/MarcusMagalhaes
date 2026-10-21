// FinFlow — service worker (PWA): permite instalar o app e abrir a casca sem internet.
//  • Navegação (index.html): rede primeiro (sempre a versão nova); sem rede, a última guardada.
//  • /assets/* (nomes com hash, imutáveis): cache primeiro.
//  • Ícones/manifesto: rede com reserva no cache.
//  • Dados (Supabase e outras origens) nunca passam por aqui: só a mesma origem é tratada, e /api/ nunca é guardado.
const CACHE = 'finflow-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k)
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const r = await fetch(req)
        const c = await caches.open(CACHE); c.put('/index.html', r.clone())
        return r
      } catch { return (await caches.match('/index.html')) || Response.error() }
    })())
    return
  }
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith((async () => {
      const guardado = await caches.match(req)
      if (guardado) return guardado
      const r = await fetch(req)
      if (r.ok) { const c = await caches.open(CACHE); c.put(req, r.clone()) }
      return r
    })())
    return
  }
  e.respondWith((async () => {
    try {
      const r = await fetch(req)
      if (r.ok) { const c = await caches.open(CACHE); c.put(req, r.clone()) }
      return r
    } catch { return (await caches.match(req)) || Response.error() }
  })())
})
