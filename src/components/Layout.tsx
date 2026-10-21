import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { LogoEmpresa, LogoMark } from './Logo'
import { useAuth } from '@/lib/auth'
import { PAPEIS, ehAdmin, ehAdminTI, ehOperador, type Papel } from '@/lib/types'
import { Carregando, TelaComErro } from './ui'
import { useInstalarApp } from '@/lib/pwa'
import { VERSAO } from '@/versao'

type Item = { to: string; label: string; icone: ReactNode }
type Grupo = { grupo: string; icone: ReactNode; itens: Item[] }
type Entrada = Item | Grupo
const ehGrupo = (e: Entrada): e is Grupo => 'grupo' in e

/** Menu pelo papel na empresa em uso. Todos os papéis leem o financeiro e os relatórios; a conciliação é de quem opera;
 *  o grupo Administração é de diretoria, administrador e TI. O banco confere tudo de novo (0005). */
export function montarMenu(p: { papel: Papel } | null): Entrada[] {
  if (!p) return []
  const m: Entrada[] = [
    { to: '/painel', label: 'Painel', icone: '📊' },
    { grupo: 'Financeiro', icone: '💰', itens: [
      { to: '/financeiro/pagar', label: 'Contas a pagar', icone: '🔻' },
      { to: '/financeiro/receber', label: 'Contas a receber', icone: '🔺' },
      { to: '/financeiro/lancamentos', label: 'Lançamentos', icone: '🧾' },
      ...(ehOperador(p) ? [{ to: '/financeiro/conciliacao', label: 'Conciliação bancária', icone: '🏦' }] : []),
      { to: '/financeiro/fechamento', label: 'Fechamento do mês', icone: '📒' },
      { to: '/financeiro/orcamento', label: 'Orçamento', icone: '🎯' },
    ] },
    { grupo: 'Relatórios', icone: '📈', itens: [
      { to: '/relatorios/fluxo-caixa', label: 'Fluxo de caixa', icone: '🌊' },
      { to: '/relatorios/dre', label: 'DRE gerencial', icone: '📑' },
      { to: '/relatorios/mensal', label: 'Relatório mensal', icone: '🗓️' },
      { to: '/relatorios/extrato', label: 'Extrato por conta', icone: '📃' },
    ] },
    { grupo: 'Cadastros', icone: '🗃️', itens: [
      { to: '/cadastros/parceiros', label: 'Clientes e fornecedores', icone: '🤝' },
      { to: '/cadastros/contas', label: 'Contas financeiras', icone: '💳' },
      { to: '/cadastros/centros-custo', label: 'Centros de custo', icone: '🏷️' },
    ] },
  ]
  if (ehAdmin(p)) {
    m.push({ grupo: 'Administração', icone: '🛡️', itens: [
      { to: '/admin/usuarios', label: 'Usuários', icone: '🔐' },
      { to: '/admin/empresa', label: ehAdminTI(p) ? 'Empresas' : 'Empresa', icone: '🏢' },
      { to: '/admin/auditoria', label: 'Auditoria', icone: '🔍' },
    ] })
  }
  return m
}

export default function Layout() {
  const { usuario, empresa, empresas, perfil, sair, escolherEmpresa } = useAuth()
  const [aberto, setAberto] = useState(false)
  const [recolhido, setRecolhido] = useState(() => { try { return localStorage.getItem('menuRecolhido') === '1' } catch { return false } })
  const { pathname } = useLocation()
  const [gruposFechados, setGruposFechados] = useState<Record<string, boolean>>({})
  useEffect(() => { setGruposFechados({}) }, [pathname])
  const [grupoTopo, setGrupoTopo] = useState<string | null>(null)
  const refTopo = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!grupoTopo) return
    const h = (e: MouseEvent) => { if (refTopo.current && !refTopo.current.contains(e.target as Node)) setGrupoTopo(null) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [grupoTopo])
  useEffect(() => { try { localStorage.setItem('menuRecolhido', recolhido ? '1' : '0') } catch { /* sem armazenamento */ } }, [recolhido])
  const menu = montarMenu(perfil)
  const podeTrocar = empresas.length > 1
  const nomeEmpresa = empresa?.nome_fantasia || empresa?.razao_social || ''
  const app = useInstalarApp()
  const [dicaIos, setDicaIos] = useState(false)
  const botaoInstalar = app.modo && (
    <button className="mb-1.5 flex w-full items-center gap-2 rounded-lg bg-laranja-500/10 px-2.5 py-1.5 text-xs font-semibold text-laranja-700 hover:bg-laranja-500/20"
      onClick={() => (app.modo === 'prompt' ? app.instalar() : setDicaIos(true))}>📲 Instalar o app</button>
  )

  const link = (m: Item, sub = false) => (
    <NavLink key={m.to} to={m.to} end onClick={() => { setAberto(false); setGruposFechados({}) }}
      className={({ isActive }) => `flex items-center gap-2 rounded-lg px-2.5 whitespace-nowrap border-l-[3px] ${sub ? 'py-1 ml-3 text-xs' : 'py-1.5 text-[13px]'} font-medium transition ${isActive ? 'bg-grafite-900 text-white border-laranja-500' : 'text-slate-700 border-transparent hover:bg-grafite-50'}`}>
      <span className="text-base leading-none">{m.icone}</span>{m.label}
    </NavLink>
  )
  const nav = (
    <nav className="flex flex-col gap-0.5 p-3">
      {botaoInstalar}
      {menu.map((m) => {
        if (!ehGrupo(m)) return link(m)
        const ativo = m.itens.some((i) => pathname.startsWith(i.to))
        const abertoG = gruposFechados[m.grupo] === undefined ? true : !gruposFechados[m.grupo]
        return (
          <div key={m.grupo}>
            <button onClick={() => setGruposFechados({ ...gruposFechados, [m.grupo]: abertoG })}
              className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition whitespace-nowrap ${ativo ? 'text-grafite-900 font-bold' : 'text-slate-700'} hover:bg-grafite-50`}>
              <span className="text-base leading-none">{m.icone}</span>{m.grupo}<span className="ml-auto text-xs">{abertoG ? '▾' : '▸'}</span>
            </button>
            {abertoG && <div className="flex flex-col gap-0.5 mt-0.5">{m.itens.map((i) => link(i, true))}</div>}
          </div>
        )
      })}
    </nav>
  )
  const cabecalhoEmpresa = (
    <div className="p-3 border-b-4 border-laranja-500 bg-white">
      <div className="flex items-center gap-2.5">
        <LogoEmpresa caminho={empresa?.logo_caminho} nome={nomeEmpresa || '?'} tamanho={44} />
        <div className="min-w-0">
          <div className="text-sm font-extrabold text-grafite-900 leading-tight truncate" title={empresa?.razao_social}>{nomeEmpresa}</div>
          <div className="text-[11px] text-laranja-700 font-semibold truncate">{perfil ? PAPEIS[perfil.papel] : ''}</div>
        </div>
      </div>
      <div className="mt-2 text-xs">
        <div className="font-semibold text-slate-800 truncate">{usuario?.nome}</div>
        <div className="text-slate-500 truncate">{usuario?.email}</div>
        {podeTrocar && <button className="mt-0.5 text-laranja-700 underline" onClick={() => escolherEmpresa(null)}>trocar empresa</button>}
      </div>
    </div>
  )
  const rodape = (
    <div className="p-3 border-t border-slate-200 flex items-center justify-between text-xs">
      <span className="flex items-center gap-1.5 text-slate-400" title={`Finanway · build ${VERSAO}`}><LogoMark size={18} /><span className="font-semibold">Finanway</span><span className="tabular-nums">v{VERSAO}</span></span>
      <button className="text-laranja-700 font-semibold underline" onClick={sair}>Sair</button>
    </div>
  )

  return (
    <div className="flex h-full">
      <aside className={`hidden md:flex flex-col bg-white border-r border-slate-200 no-print transition-all ${recolhido ? 'w-0 overflow-hidden border-r-0' : 'w-56'}`}>
        <div className="relative">
          {cabecalhoEmpresa}
          <button className="absolute right-2 top-2 rounded p-1 text-slate-400 hover:bg-slate-100" title="Esconder menu" onClick={() => setRecolhido(true)}>«</button>
        </div>
        <div className="flex-1 overflow-auto">{nav}</div>
        {rodape}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="md:hidden flex items-center justify-between bg-white border-b-4 border-laranja-500 px-3 py-1.5 no-print">
          <button className="rounded p-2 text-2xl leading-none text-grafite-900" onClick={() => setAberto(true)} aria-label="Menu">☰</button>
          <div className="flex min-w-0 items-center gap-2"><LogoEmpresa caminho={empresa?.logo_caminho} nome={nomeEmpresa || '?'} tamanho={28} /><span className="truncate text-sm font-extrabold text-grafite-900">{nomeEmpresa}</span></div>
          <button className="text-xs text-laranja-700 font-semibold px-2" onClick={sair}>Sair</button>
        </header>
        {recolhido && (
          <div className="hidden md:flex items-center gap-1.5 bg-white border-b border-slate-200 px-2 py-1 no-print">
            <button className="shrink-0 rounded p-1 text-slate-600 hover:bg-slate-100 text-lg leading-none" title="Mostrar menu" onClick={() => setRecolhido(false)}>☰</button>
            <LogoEmpresa caminho={empresa?.logo_caminho} nome={nomeEmpresa || '?'} tamanho={26} />
            <span className="shrink-0 text-xs font-bold text-grafite-900 whitespace-nowrap">{nomeEmpresa}</span>
            <nav ref={refTopo} className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5 overflow-visible">
              {menu.map((m) => ehGrupo(m) ? (
                <div key={m.grupo} className="relative">
                  <button onClick={() => setGrupoTopo(grupoTopo === m.grupo ? null : m.grupo)} className={`rounded px-1.5 py-1 text-xs font-medium whitespace-nowrap ${m.itens.some((i) => pathname.startsWith(i.to)) ? 'bg-grafite-900 text-white' : 'text-slate-600 hover:bg-grafite-50'}`}>
                    {m.icone} <span className="hidden xl:inline">{m.grupo}</span> ▾
                  </button>
                  {grupoTopo === m.grupo && (
                    <div className="absolute z-40 left-0 top-full pt-1 w-56"><div className="rounded-lg border border-slate-200 bg-white shadow-lg py-1">
                      {m.itens.map((i) => <NavLink key={i.to} to={i.to} end onClick={() => setGrupoTopo(null)} className={({ isActive }) => `block px-3 py-1.5 text-xs ${isActive ? 'bg-grafite-900 text-white' : 'text-slate-700 hover:bg-grafite-50'}`}>{i.icone} {i.label}</NavLink>)}
                    </div></div>
                  )}
                </div>
              ) : (
                <NavLink key={m.to} to={m.to} end className={({ isActive }) => `rounded px-1.5 py-1 text-xs font-medium whitespace-nowrap ${isActive ? 'bg-grafite-900 text-white' : 'text-slate-600 hover:bg-grafite-50'}`} title={m.label}>
                  {m.icone} <span className="hidden xl:inline">{m.label}</span>
                </NavLink>
              ))}
            </nav>
            {podeTrocar && <button className="shrink-0 whitespace-nowrap text-xs text-laranja-700 underline" onClick={() => escolherEmpresa(null)}>trocar empresa</button>}
            <button className="shrink-0 text-xs text-laranja-700 font-semibold" onClick={sair}>Sair</button>
            <span className="shrink-0 text-[10px] text-slate-400 tabular-nums" title="Versão do sistema (build)">v{VERSAO}</span>
          </div>
        )}
        <main className="flex-1 overflow-auto px-2 pb-2 pt-1">
          <TelaComErro chave={pathname}><Suspense fallback={<Carregando />}><Outlet /></Suspense></TelaComErro>
        </main>
      </div>

      {aberto && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setAberto(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <aside className="absolute left-0 top-0 h-full w-72 bg-white shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="relative">
              {cabecalhoEmpresa}
              <button onClick={() => setAberto(false)} className="absolute right-3 top-2 text-xl text-slate-500">✕</button>
            </div>
            <div className="flex-1 overflow-auto">{nav}</div>
            {rodape}
          </aside>
        </div>
      )}
      {dicaIos && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-3 sm:items-center" onClick={() => setDicaIos(false)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-4 text-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <b className="text-grafite-900">Instalar no iPhone</b>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-700">
              <li>No Safari, toque em <b>Compartilhar</b> (o quadrado com a seta para cima).</li>
              <li>Escolha <b>Adicionar à Tela de Início</b>.</li>
              <li>Toque em <b>Adicionar</b>. O Finanway aparece como um app.</li>
            </ol>
            <div className="mt-3 flex justify-end"><button className="btn-primary" onClick={() => setDicaIos(false)}>Entendi</button></div>
          </div>
        </div>
      )}
    </div>
  )
}
