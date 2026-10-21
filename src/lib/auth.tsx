// Sessão, conta (usuario), empresas em que a pessoa pode entrar e a empresa/papel em uso.
// Fluxo (o mesmo do Luminexus): login Google → conta → minhas_empresas() → uma só: entra direto; várias: tela de escolha
// (escolher_empresa grava no banco, e é o que as políticas RLS usam para isolar os dados).
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, ok } from './supabase'
import { definirEmpresaAtual } from './arquivos'
import { carregarDadosEmpresa } from './empresa'
import type { EmpresaAcesso, Papel, Usuario } from './types'
import { ehJanelaLogin } from './pwa'

const metodoSessao = (s: Session | null) => (s?.user.app_metadata?.provider === 'google' ? 'google' : 'senha')

interface AuthCtx {
  session: Session | null
  usuario: Usuario | null
  /** empresas em que a conta pode entrar */
  empresas: EmpresaAcesso[]
  /** empresa em uso (null = precisa escolher) */
  empresa: EmpresaAcesso | null
  /** papel na empresa em uso, no formato que ehAdmin()/ehFinanceiro()… aceitam */
  perfil: { papel: Papel } | null
  carregando: boolean
  erro: string | null
  entrar: (email: string, senha: string) => Promise<void>
  sair: () => Promise<void>
  recarregar: () => Promise<void>
  /** lê a sessão que outra janela do app gravou (login no app instalado do iPhone) e carrega a conta; devolve se há sessão */
  sincronizar: () => Promise<boolean>
  escolherEmpresa: (empresaId: number | null) => Promise<void>
}

const Ctx = createContext<AuthCtx>(null!)

async function registrarLogin(email: string | null | undefined, evento: 'LOGIN_OK' | 'LOGIN_FALHA' | 'LOGOUT', motivo?: string, metodo?: string) {
  try {
    await supabase.rpc('registrar_login', { p_email: email ?? '', p_evento: evento, p_motivo: motivo ?? null, p_metodo: metodo ?? null, p_agente: navigator.userAgent })
  } catch { /* auditoria nunca bloqueia o uso */ }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [empresas, setEmpresas] = useState<EmpresaAcesso[]>([])
  const [empresa, setEmpresa] = useState<EmpresaAcesso | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const idCarregado = useRef<string | null>(null)
  const sessaoAtual = useRef<Session | null>(null)

  function aplicarEmpresa(e: EmpresaAcesso | null) { setEmpresa(e); definirEmpresaAtual(e?.empresa_id ?? null); carregarDadosEmpresa(e?.empresa_id ?? null).catch(() => {}) }

  async function carregarUsuario(s: Session | null) {
    idCarregado.current = null
    if (!s) { setUsuario(null); setEmpresas([]); aplicarEmpresa(null); return }
    // conta e empresas juntas (minhas_empresas não depende da linha de usuario; se a conta for recusada, o resultado é descartado)
    const empresasP = Promise.resolve(supabase.rpc('minhas_empresas')).then((r) => ({ lista: (ok(r) ?? []) as EmpresaAcesso[], erro: null as string | null }), (e: any) => ({ lista: [] as EmpresaAcesso[], erro: String(e?.message ?? e) }))
    const { data, error } = await supabase.from('usuario').select('*').eq('id', s.user.id).maybeSingle()
    if (error) { setErro(error.message); setUsuario(null); return }
    if (!data) { setErro('Sua conta foi reconhecida, mas ainda não está cadastrada no sistema. Tente sair e entrar de novo.'); setUsuario(null); registrarLogin(s.user.email, 'LOGIN_FALHA', 'sem cadastro no sistema', metodoSessao(s)); return }
    if (!data.ativo) { setErro(`Olá, ${data.nome}. Sua conta está bloqueada. Fale com o administrador.`); setUsuario(null); registrarLogin(s.user.email, 'LOGIN_FALHA', 'conta bloqueada', metodoSessao(s)); return }
    const emp = await empresasP
    if (emp.erro) { setErro(emp.erro); setUsuario(null); return }
    const lista = emp.lista
    if (!lista.length) {
      setErro(`Olá, ${data.nome}. Sua conta ainda não tem acesso a nenhuma empresa. Peça ao administrador da empresa para liberar o seu e-mail Google (${data.email}).`)
      setUsuario(null); registrarLogin(s.user.email, 'LOGIN_FALHA', 'sem vínculo com empresa', metodoSessao(s)); return
    }
    let atual = lista.find((i) => i.empresa_id === data.empresa_atual_id) ?? null
    if (!atual && lista.length === 1) {
      try { ok(await supabase.rpc('escolher_empresa', { p_empresa_id: lista[0].empresa_id })); atual = lista[0]; data.empresa_atual_id = atual.empresa_id } catch (e: any) { setErro(e.message) }
    }
    setErro(null)
    idCarregado.current = s.user.id
    setUsuario(data as Usuario); setEmpresas(lista); aplicarEmpresa(atual)
  }

  // getSession e o evento INITIAL_SESSION chegam juntos ao abrir o app: a mesma carga serve aos dois
  const emCurso = useRef<{ id: string; p: Promise<void> } | null>(null)
  function carregarUsuarioUnico(s: Session | null) {
    const id = s?.user.id ?? ''
    if (emCurso.current?.id === id) return emCurso.current.p
    const p: Promise<void> = carregarUsuario(s).finally(() => { if (emCurso.current?.p === p) emCurso.current = null })
    emCurso.current = { id, p }
    return p
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      sessaoAtual.current = data.session
      setSession(data.session)
      await carregarUsuarioUnico(data.session)
      setCarregando(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange(async (evento, s) => {
      sessaoAtual.current = s
      setSession(s)
      if (s && s.user.id === idCarregado.current && evento !== 'USER_UPDATED') return
      // a janela de login do app instalado não registra: quem registra é o app, ao receber a sessão
      if (evento === 'SIGNED_IN' && s && !ehJanelaLogin()) registrarLogin(s.user.email, 'LOGIN_OK', undefined, metodoSessao(s))
      await carregarUsuarioUnico(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  async function entrar(email: string, senha: string) {
    setErro(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
    if (error) {
      registrarLogin(email, 'LOGIN_FALHA', error.message === 'Invalid login credentials' ? 'e-mail ou senha inválidos' : error.message, 'senha')
      throw new Error(error.message === 'Invalid login credentials' ? 'E-mail ou senha inválidos' : error.message)
    }
  }
  async function sair() { await registrarLogin(session?.user.email, 'LOGOUT', undefined, metodoSessao(session)); await supabase.auth.signOut(); setUsuario(null); setEmpresas([]); aplicarEmpresa(null) }
  const recarregar = () => carregarUsuario(sessaoAtual.current)
  async function sincronizar() {
    const { data } = await supabase.auth.getSession()
    if (!data.session) return false
    if (data.session.user.id !== idCarregado.current) {
      sessaoAtual.current = data.session; setSession(data.session)
      registrarLogin(data.session.user.email, 'LOGIN_OK', undefined, metodoSessao(data.session))
      await carregarUsuario(data.session)
    }
    return true
  }
  /** Escolhe (ou, com null, volta para a tela de escolha) */
  async function escolherEmpresa(empresaId: number | null) {
    if (empresaId === null) { aplicarEmpresa(null); return }
    ok(await supabase.rpc('escolher_empresa', { p_empresa_id: empresaId }))
    // a lista pode ter mudado (empresa criada pelo TI): busca de novo
    const lista = (ok(await supabase.rpc('minhas_empresas')) ?? []) as EmpresaAcesso[]
    setEmpresas(lista)
    setUsuario((u) => (u ? { ...u, empresa_atual_id: empresaId } : u))
    aplicarEmpresa(lista.find((x) => x.empresa_id === empresaId) ?? null)
  }

  const perfil = empresa ? { papel: empresa.papel } : null
  return <Ctx.Provider value={{ session, usuario, empresas, empresa, perfil, carregando, erro, entrar, sair, recarregar, sincronizar, escolherEmpresa }}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)
