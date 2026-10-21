import { useEffect, useRef, useState, type FormEvent } from 'react'
import Logo from '@/components/Logo'
import { useAuth } from '@/lib/auth'
import { supabase, supabaseConfigurado } from '@/lib/supabase'
import { carregarGoogle, GOOGLE_CLIENT_ID, novoNonce } from '@/lib/googleLogin'
import { CHAVE_JANELA_LOGIN, instalado } from '@/lib/pwa'
import { Carregando } from '@/components/ui'

// iPhone/iPad: a janela (popup) do botão oficial do Google às vezes fica em branco no Safari e não volta ao site
// (Luminexus, 14/10). Ali o login vai pelo redirecionamento do Supabase (mesma aba). Nos demais aparelhos segue o botão oficial.
const IOS = typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
// App instalado no iPhone (tela de início; Luminexus 1.1.025): o armazenamento é separado do Safari. Navegar para o Google sai do
// escopo do app e o iOS pode levar o login para o Safari — a sessão nunca chegava ao app ("fica pedindo login"). Orientação
// da Apple (WWDC23, "What's new in web apps"): o que é aberto com window.open fica sempre dentro do web app. Então a janela
// é aberta no toque (síncrona), recebe o endereço do Google, e a volta cai nela: o código é trocado pela sessão no
// armazenamento do app, a janela mostra "Login concluído" (JanelaLogin) e se fecha; o app recebe a sessão pelo
// BroadcastChannel do supabase-js ou pela leitura periódica (sincronizar).
// navegador interno de app (Instagram, Facebook…): o Google recusa login dentro dele
const APP_INTERNO = typeof navigator !== 'undefined' && /FBAN|FBAV|Instagram|Line\/|; wv\)/.test(navigator.userAgent)

/** aviso: texto de contexto acima do botão */
export default function Login({ aviso }: { aviso?: string } = {}) {
  const { entrar, erro, session, sair, sincronizar } = useAuth()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [comSenha, setComSenha] = useState(false)
  const botaoGoogle = useRef<HTMLDivElement>(null)
  const mostraBotao = !(session && erro)
  // app instalado no iPhone: espera a sessão gravada pela janela de login (até 5 min); quando chega, o app troca de tela sozinho
  const espera = useRef<number | null>(null)
  useEffect(() => () => { if (espera.current) window.clearInterval(espera.current) }, [])
  function esperarSessao() {
    if (espera.current) window.clearInterval(espera.current)
    const inicio = Date.now()
    espera.current = window.setInterval(async () => {
      if ((await sincronizar().catch(() => false)) || Date.now() - inicio > 5 * 60e3) {
        if (espera.current) window.clearInterval(espera.current)
        espera.current = null; setOcupado(false)
      }
    }, 1500)
  }

  // botão oficial do Google: o login acontece numa janela do Google sobre o site e volta com o ID token
  useEffect(() => {
    if (IOS || !mostraBotao || !supabaseConfigurado || !GOOGLE_CLIENT_ID) return
    let ativo = true
    ;(async () => {
      try {
        const [g, nonce] = await Promise.all([carregarGoogle(), novoNonce()])
        if (!ativo || !botaoGoogle.current) return
        g.initialize({
          client_id: GOOGLE_CLIENT_ID, nonce: nonce.hash, ux_mode: 'popup', use_fedcm_for_button: true,
          callback: async ({ credential }) => {
            setMsg(null); setOcupado(true)
            const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: credential, nonce: nonce.bruto })
            if (error) setMsg(error.message)
            setOcupado(false)
          },
        })
        g.renderButton(botaoGoogle.current, {
          type: 'standard', theme: 'outline', size: 'large', shape: 'rectangular', text: 'signin_with',
          logo_alignment: 'center', locale: 'pt-BR', width: Math.min(botaoGoogle.current.clientWidth || 320, 400),
        })
      } catch (e: any) { if (ativo) setMsg(e.message) }
    })()
    return () => { ativo = false }
  }, [mostraBotao])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setMsg(null); setOcupado(true)
    try { await entrar(email.trim(), senha) } catch (err: any) { setMsg(err.message) } finally { setOcupado(false) }
  }

  // redirecionamento pelo Supabase: padrão no iPhone e reserva nos demais (botão não carregou ou janela em branco)
  async function google() {
    setMsg(null); setOcupado(true)
    const redirectTo = window.location.origin + window.location.pathname
    if (IOS && instalado()) {
      const janela = window.open('about:blank', '_blank')   // síncrono, dentro do toque: é o que o iOS mantém no app
      if (!janela) { setMsg('O iPhone não abriu a janela de login. Toque no botão outra vez.'); setOcupado(false); return }
      try { janela.sessionStorage.setItem(CHAVE_JANELA_LOGIN, '1') } catch { /* sem a marca a janela mostra o app inteiro, mas o login conclui */ }
      const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true } })
      if (error || !data.url) { janela.close(); setMsg(error?.message ?? 'Não foi possível iniciar o login'); setOcupado(false); return }
      janela.location.href = data.url
      esperarSessao()
      return
    }
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })
    if (error) { setMsg(error.message); setOcupado(false) }
  }

  return (
    <div className="min-h-full flex flex-col items-center justify-center bg-grafite-950 bg-[radial-gradient(ellipse_at_top,#3a4046_0%,#181b1f_70%)] p-4">
      <Logo size={230} className="mb-4" />
      <div className="card w-full max-w-sm p-6 sm:p-8 border-t-4 border-t-laranja-500">
        {!supabaseConfigurado && (
          <div className="my-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
            Banco não configurado. Crie o arquivo <code>.env</code> a partir de <code>.env.example</code>.
          </div>
        )}
        {session && erro ? (
          <div className="mt-4 space-y-4">
            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{erro}</div>
            <div className="text-xs text-slate-500">Conectado como {session.user.email}</div>
            <button className="btn-secondary w-full" onClick={sair}>Sair e entrar com outra conta</button>
          </div>
        ) : (
          <>
            {aviso && <div className="mt-3 mb-3 rounded-lg bg-laranja-50 p-3 text-xs text-grafite-800">{aviso}</div>}
            <p className="text-center text-sm text-slate-500 mb-6">Entre com sua conta Google</p>
            {APP_INTERNO && (
              <div className="mb-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                Este link abriu dentro de outro aplicativo, e o Google não permite entrar por aqui. Toque em ⋯ e escolha
                <b> Abrir no navegador</b> (Chrome ou Safari).
              </div>
            )}
            {IOS ? (
              <button type="button" onClick={google} disabled={ocupado}
                className="flex w-full items-center justify-center gap-3 rounded border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
                <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.9 6.1C12.4 13.7 17.7 9.5 24 9.5z" />
                  <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 7l7.2 5.6c4.2-3.9 7.1-9.7 7.1-17z" />
                  <path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C.9 16.6 0 20.2 0 24s.9 7.4 2.6 10.7l7.9-6.1z" />
                  <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.2-5.6c-2 1.4-4.7 2.3-8.7 2.3-6.3 0-11.6-4.2-13.5-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
                </svg>
                Fazer login com o Google
              </button>
            ) : <div ref={botaoGoogle} className="flex justify-center min-h-[44px]" />}
            {ocupado && <div className="mt-2 text-center text-xs text-slate-500">{IOS && instalado() ? 'Entrando… conclua o login na janela do Google e volte para cá.' : 'Entrando…'}</div>}
            {!IOS && (
              <button className="mt-3 w-full text-center text-[11px] text-slate-400 underline" onClick={google} disabled={ocupado}>
                o botão não apareceu ou a tela do Google ficou em branco? entrar de outra forma
              </button>
            )}
            <button className="mt-1 w-full text-center text-xs text-slate-400 underline" onClick={() => setComSenha(!comSenha)}>
              {comSenha ? 'ocultar login com senha' : 'entrar com e-mail e senha'}
            </button>
            {comSenha && (
              <form onSubmit={submit} className="mt-3 space-y-3">
                <div><label className="label">E-mail</label><input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
                <div><label className="label">Senha</label><input className="input" type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required /></div>
                <button className="btn-primary w-full py-3" disabled={ocupado}>{ocupado ? 'Entrando…' : 'Entrar'}</button>
              </form>
            )}
            {(msg || erro) && <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{msg ?? erro}</div>}
          </>
        )}
      </div>
      <div className="mt-4 text-[11px] text-grafite-300">Finanway · contas a pagar e receber, fluxo de caixa e DRE</div>
    </div>
  )
}

/** Janela que o app instalado no iPhone abre só para o login (Luminexus 1.1.025): o supabase-js troca o código pela sessão aqui
 *  (mesmo armazenamento do app), a janela avisa e se fecha; o app, na outra janela, recebe a sessão e abre sozinho. */
export function JanelaLogin() {
  const { session, erro } = useAuth()
  const [demorou, setDemorou] = useState(false)
  useEffect(() => { const t = window.setTimeout(() => setDemorou(true), 20000); return () => window.clearTimeout(t) }, [])
  useEffect(() => {
    if (!session || erro) return
    const t = window.setTimeout(() => window.close(), 1500)   // o iOS pode não fechar sozinho: fica o botão
    return () => window.clearTimeout(t)
  }, [session, erro])
  // reserva: usar o app aqui mesmo (tira a marca e recarrega; a sessão já está no armazenamento)
  const usarAqui = () => { try { sessionStorage.removeItem(CHAVE_JANELA_LOGIN) } catch { /* sem armazenamento */ } window.location.replace(window.location.origin + window.location.pathname) }
  return (
    <div className="min-h-full flex flex-col items-center justify-center bg-grafite-950 bg-[radial-gradient(ellipse_at_top,#3a4046_0%,#181b1f_70%)] p-4">
      <Logo size={150} className="mb-4" />
      <div className="card w-full max-w-sm p-6 text-center text-sm border-t-4 border-t-laranja-500">
        {session && !erro ? (
          <>
            <div className="text-lg font-bold text-grafite-900">Login concluído ✓</div>
            <p className="mt-2 text-slate-600">Feche esta janela para voltar ao Finanway: o app já está conectado.</p>
            <button className="btn-primary mt-4 w-full py-3" onClick={() => window.close()}>Fechar esta janela</button>
          </>
        ) : erro ? (
          <>
            <div className="rounded-lg bg-amber-50 p-3 text-amber-800">{erro}</div>
            <button className="btn-secondary mt-4 w-full" onClick={() => window.close()}>Fechar</button>
          </>
        ) : (
          <>
            <Carregando texto="Concluindo o login…" className="min-h-[20vh]" />
            {demorou && <p className="mt-2 text-xs text-slate-500">Está demorando. Feche esta janela e toque de novo em "Fazer login com o Google" no app.</p>}
          </>
        )}
        {session && <button className="mt-3 w-full text-[11px] text-slate-400 underline" onClick={usarAqui}>usar o app nesta janela</button>}
      </div>
    </div>
  )
}
