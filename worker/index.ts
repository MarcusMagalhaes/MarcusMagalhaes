// Finanway — Worker do Cloudflare: serve o site (assets) e registra as violações da CSP.
//  • www.<domínio> redireciona para o domínio principal.
//  • /api/csp (POST): o navegador manda o relatório quando a Content-Security-Policy bloqueia algo; vai para o log do
//    Worker (npx wrangler tail finanway). Nada de dado da empresa passa por aqui.
//  • Integrações com outros sistemas (fase 2, ver README › Roteiro) entram como rotas /api/… deste Worker.

interface Env {
  ASSETS: { fetch: (r: Request) => Promise<Response> }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    // um só endereço (o login do Google e o Supabase conferem a origem): www.finanway.com.br → finanway.com.br
    if (url.hostname.startsWith('www.')) {
      url.hostname = url.hostname.slice(4)
      return Response.redirect(url.toString(), 301)
    }
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
