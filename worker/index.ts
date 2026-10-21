// Finanway — Worker do Cloudflare: serve o site (assets) e registra as violações da CSP.
//  • /api/csp (POST): o navegador manda o relatório quando a Content-Security-Policy bloqueia algo; vai para o log do
//    Worker (npx wrangler tail finanway). Nada de dado da empresa passa por aqui.
//  • Integrações com outros sistemas (fase 2, ver README › Roteiro) entram como rotas /api/… deste Worker.

interface Env {
  ASSETS: { fetch: (r: Request) => Promise<Response> }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/api/csp' && req.method === 'POST') {
      try {
        const corpo = (await req.text()).slice(0, 4000)
        const r = JSON.parse(corpo)['csp-report'] ?? JSON.parse(corpo)
        console.warn('CSP bloqueou:', JSON.stringify({ diretiva: r['violated-directive'] ?? r.effectiveDirective, bloqueado: r['blocked-uri'] ?? r.blockedURL, pagina: r['document-uri'] ?? r.documentURL }))
      } catch { /* relatório malformado: ignora */ }
      return new Response(null, { status: 204 })
    }
    if (url.pathname.startsWith('/api/')) return new Response('Não encontrado', { status: 404 })
    return env.ASSETS.fetch(req)
  },
}
