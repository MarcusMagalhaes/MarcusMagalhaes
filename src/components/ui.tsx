import { Component, createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ErrorInfo, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { assinarEspera, emEspera, iniciarEspera, textoEspera } from '@/lib/ocupado'
import { arquivoVisto, assinarVisualizador, fecharVisualizador } from '@/lib/visualizador'
import { useTelaGrande } from '@/lib/tela'

// ---------- Toast ----------
type Toast = { id: number; tipo: 'ok' | 'erro' | 'info'; msg: string }
const ToastCtx = createContext<{ toast: (msg: string, tipo?: Toast['tipo']) => void }>({ toast: () => {} })
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [lista, setLista] = useState<Toast[]>([])
  const seq = useRef(0)
  const toast = (msg: string, tipo: Toast['tipo'] = 'ok') => {
    const id = ++seq.current
    setLista((l) => [...l, { id, tipo, msg }])
    setTimeout(() => setLista((l) => l.filter((t) => t.id !== id)), tipo === 'erro' ? 6000 : 3000)
  }
  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 flex-col gap-2 px-4 w-full max-w-md no-print">
        {lista.map((t) => (
          <div key={t.id} className={`rounded-lg px-4 py-3 text-sm font-medium shadow-lg text-white ${t.tipo === 'erro' ? 'bg-red-600' : t.tipo === 'info' ? 'bg-slate-700' : 'bg-emerald-600'}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

// ---------- Modal ----------
/** modais abertos, do mais antigo ao de cima: o Esc fecha só o de cima */
const pilhaModais: object[] = []
export function Modal({ aberto, titulo, onFechar, children, largura }:
  { aberto: boolean; titulo: ReactNode; onFechar: () => void; children: ReactNode; largura?: string }) {
  const eu = useRef({})
  const fechar = useRef(onFechar); fechar.current = onFechar
  useEffect(() => {
    if (!aberto) return
    const id = eu.current
    pilhaModais.push(id)
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && pilhaModais[pilhaModais.length - 1] === id) fechar.current() }
    window.addEventListener('keydown', h)
    return () => { window.removeEventListener('keydown', h); const i = pilhaModais.lastIndexOf(id); if (i >= 0) pilhaModais.splice(i, 1) }
  }, [aberto])
  if (!aberto) return null
  const cheia = !largura
  // na raiz da página: modal aberto de dentro de outro (ex.: recorte da logo na ficha) fica sempre por cima
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-3" onClick={onFechar}>
      <div className={`card flex flex-col w-full ${cheia ? 'sm:w-[96vw] sm:h-[94vh] h-[96vh]' : `${largura} max-h-[95vh]`} overflow-hidden rounded-b-none sm:rounded-b-xl`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-1.5 bg-white shrink-0">
          <h2 className="text-sm font-bold text-slate-800">{titulo}</h2>
          <button className="rounded-full px-2 text-slate-500 hover:bg-slate-100" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>
        <div className={`flex-1 min-h-0 overflow-auto p-3 ${cheia ? 'text-xs' : ''}`}>{children}</div>
      </div>
    </div>,
    document.body,
  )
}

// ---------- Visualizador de arquivos ----------
export function Visualizador() {
  const arq = useSyncExternalStore(assinarVisualizador, arquivoVisto)
  const [falhou, setFalhou] = useState(false)
  useEffect(() => {
    setFalhou(false)
    if (!arq) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); fecharVisualizador() } }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [arq])
  if (!arq) return null
  const tipo = falhou ? 'outro' : arq.tipo
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-0 sm:p-3" onClick={fecharVisualizador}>
      <div className="card flex flex-col w-full h-full sm:w-[92vw] sm:h-[94vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-2 border-b border-slate-200 px-3 py-1 bg-white shrink-0">
          <a className="btn-secondary py-0.5 text-xs" href={arq.url} download={arq.nome} title="Salvar o arquivo no computador">Baixar</a>
          <button className="rounded-full px-2 text-slate-500 hover:bg-slate-100" onClick={fecharVisualizador} aria-label="Fechar">✕</button>
        </div>
        <div className="flex-1 min-h-0 bg-slate-100 flex items-center justify-center overflow-auto">
          <TelaComErro chave={arq.url}>{tipo === 'imagem' ? <img src={arq.url} alt="" className="max-w-full max-h-full object-contain" onError={() => setFalhou(true)} />
            : tipo === 'pdf' && !navigator.pdfViewerEnabled ? <div className="p-6 text-center text-sm text-slate-600">Este aparelho não mostra PDF dentro da página.<br /><a className="btn-primary mt-3 inline-block" href={arq.url} download={arq.nome}>Baixar {arq.nome}</a></div>   // celular sem leitor embutido
            : tipo === 'pdf' || tipo === 'texto' ? <iframe src={arq.url} title="Arquivo" className="w-full h-full border-0 bg-white" />
            : <div className="p-6 text-center text-sm text-slate-600">
                Este arquivo não pode ser mostrado aqui.<br />
                <a className="btn-primary mt-3 inline-block" href={arq.url} download={arq.nome}>Baixar {arq.nome}</a>
              </div>}</TelaComErro>
        </div>
      </div>
    </div>
  )
}

// ---------- Confirmação ----------
export function Confirmar({ aberto, titulo, texto, onSim, onNao, perigo }:
  { aberto: boolean; titulo: string; texto: string; onSim: () => void; onNao: () => void; perigo?: boolean }) {
  return (
    <Modal aberto={aberto} titulo={titulo} onFechar={onNao} largura="max-w-md">
      <p className="text-slate-700 mb-5 whitespace-pre-line">{texto}</p>
      <div className="acoes flex justify-end gap-2">
        <button className="btn-secondary" onClick={onNao}>Não</button>
        <button className={perigo ? 'btn-danger' : 'btn-primary'} onClick={onSim}>Sim</button>
      </div>
    </Modal>
  )
}

// ---------- Campos ----------
export function Campo({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`campo flex flex-col ${className}`}>
      <label className="label">{label}</label>
      {children}
    </div>
  )
}

/** Select simples a partir de um dicionário { valor: rótulo } */
export function Opcoes<T extends string>({ valor, opcoes, onChange, vazio = '— escolha —', className = 'input', disabled }:
  { valor: T | '' | null | undefined; opcoes: Record<T, string>; onChange: (v: T | '') => void; vazio?: string | null; className?: string; disabled?: boolean }) {
  return (
    <select className={className} value={valor ?? ''} onChange={(e) => onChange(e.target.value as T | '')} disabled={disabled}>
      {vazio !== null && <option value="">{vazio}</option>}
      {(Object.entries(opcoes) as [T, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
    </select>
  )
}

/** Abas horizontais */
export function Abas<T extends string>({ atual, abas, onChange }: { atual: T; abas: { chave: T; rotulo: ReactNode }[]; onChange: (a: T) => void }) {
  return (
    <div className="flex max-w-full overflow-x-auto rounded-lg border border-slate-300 text-xs">
      {abas.map((a) => (
        <button key={a.chave} type="button" onClick={() => onChange(a.chave)}
          className={`shrink-0 whitespace-nowrap px-3 py-1 font-semibold ${atual === a.chave ? 'bg-grafite-900 text-white' : 'bg-white text-slate-600 hover:bg-grafite-50'}`}>{a.rotulo}</button>
      ))}
    </div>
  )
}

/** Tela esperando dados: aciona o overlay padrão (Ocupado) enquanto estiver na tela */
export function Carregando({ texto, className = 'min-h-[40vh]' }: { texto?: string; className?: string }) {
  useEffect(() => iniciarEspera(texto), [texto])
  return <div className={className} aria-busy="true" />
}

const ATRASO_MS = 250
const MINIMO_MS = 400

/** Overlay padrão de carregamento (logo + mensagem), um só para o sistema inteiro: fica em App.tsx */
export function Ocupado() {
  const ativo = useSyncExternalStore(assinarEspera, emEspera)
  const texto = useSyncExternalStore(assinarEspera, textoEspera)
  const [visivel, setVisivel] = useState(false)
  const desde = useRef(0)
  useEffect(() => {
    if (ativo && !visivel) {
      const t = setTimeout(() => { desde.current = Date.now(); setVisivel(true) }, ATRASO_MS)
      return () => clearTimeout(t)
    }
    if (!ativo && visivel) {
      const t = setTimeout(() => setVisivel(false), Math.max(0, MINIMO_MS - (Date.now() - desde.current)))
      return () => clearTimeout(t)
    }
  }, [ativo, visivel])
  // rede de segurança (19/10): se ficar mais de 20 s, oferece recarregar em vez de deixar a tela parecer travada
  const [demorou, setDemorou] = useState(false)
  useEffect(() => {
    if (!visivel) { setDemorou(false); return }
    const t = setTimeout(() => setDemorou(true), 20_000)
    return () => clearTimeout(t)
  }, [visivel])
  if (!visivel) return null
  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/40" role="status" aria-live="polite">
      <div className="card w-[min(92vw,320px)] p-6 text-center">
        <img src={`${import.meta.env.BASE_URL}marca.png`} alt="" className="mx-auto h-16 w-16 animate-pulse" />
        <div className="mt-3 text-sm font-bold text-slate-800">{texto ?? 'Carregando…'}</div>
        <div className="relative mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200">
          <div className="barra-indeterminada absolute inset-y-0 w-1/3 rounded-full bg-laranja-500" />
        </div>
        <div className="mt-1 text-[11px] text-slate-500">aguarde um instante</div>
        {demorou && (
          <div className="mt-3 border-t border-slate-200 pt-3 text-xs text-slate-600">
            Está demorando mais que o normal. Confira a internet.
            <button className="btn-primary mt-2 w-full" onClick={() => window.location.reload()}>Recarregar a página</button>
          </div>
        )}
      </div>
    </div>
  )
}

/** Erro inesperado numa tela: mostra aviso com opção de tentar de novo, em vez de deixar a página em branco */
export class TelaComErro extends Component<{ children: ReactNode; chave?: string }, { erro: Error | null }> {
  state = { erro: null as Error | null }
  static getDerivedStateFromError(erro: Error) { return { erro } }
  componentDidCatch(erro: Error, info: ErrorInfo) { console.error('Erro na tela:', erro, info.componentStack) }
  componentDidUpdate(anterior: { chave?: string }) {
    if (this.state.erro && anterior.chave !== this.props.chave) this.setState({ erro: null })
  }
  render() {
    if (!this.state.erro) return this.props.children
    const versaoNova = /dynamically imported module|Failed to fetch|Loading chunk/i.test(this.state.erro.message)
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-4">
        <div className="card w-[min(92vw,420px)] p-6 text-center">
          <img src={`${import.meta.env.BASE_URL}marca.png`} alt="" className="mx-auto h-16 w-16" />
          <div className="mt-3 text-sm font-bold text-slate-800">{versaoNova ? 'Há uma versão nova do sistema' : 'Algo deu errado nesta tela'}</div>
          <div className="mt-1 text-xs text-slate-500">
            {versaoNova ? 'Recarregue a página para continuar.' : 'Nenhum dado foi perdido. Tente de novo; se continuar, recarregue a página.'}
          </div>
          {/* motivo técnico, para mandar ao suporte (ex.: foto da tela do celular) */}
          {!versaoNova && <div className="mt-2 break-words rounded bg-slate-50 px-2 py-1 text-left text-[10px] text-slate-500">{this.state.erro.name}: {this.state.erro.message} · {navigator.userAgent.replace(/^Mozilla\/5\.0 /, '').slice(0, 120)}</div>}
          <div className="mt-4 flex justify-center gap-2">
            {!versaoNova && <button className="btn-secondary" onClick={() => this.setState({ erro: null })}>Tentar de novo</button>}
            <button className="btn-primary" onClick={() => window.location.reload()}>Recarregar a página</button>
          </div>
        </div>
      </div>
    )
  }
}

/** Tela de progresso para ações em massa (ex.: "Enviando 12 de 40") */
export function Progresso({ titulo, atual, total }: { titulo: string; atual: number; total: number }) {
  const pct = total > 0 ? Math.round((atual / total) * 100) : 0
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50">
      <div className="card w-[min(92vw,420px)] p-6 text-center">
        <img src={`${import.meta.env.BASE_URL}marca.png`} alt="" className="mx-auto h-16 w-16 animate-pulse" />
        <div className="mt-3 text-sm font-bold text-slate-800">{titulo}</div>
        <div className="mt-1 text-2xl font-extrabold text-grafite-900 tabular-nums">{atual.toLocaleString('pt-BR')} de {total.toLocaleString('pt-BR')}</div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-laranja-500 transition-all" style={{ width: `${pct}%` }} /></div>
        <div className="mt-1 text-[11px] text-slate-500">{pct}% · aguarde, não feche a página</div>
      </div>
    </div>
  )
}

/** ↻ ao lado do título: busca os dados de novo mantendo filtros e seleção (F5 voltaria ao estado inicial da tela) */
export function BotaoAtualizar({ onClick, ocupado }: { onClick: () => void; ocupado?: boolean }) {
  return <button type="button" className="btn-secondary py-1 text-base leading-none" title="Atualizar dados mantendo os filtros" aria-label="Atualizar" disabled={ocupado} onClick={onClick}>↻</button>
}

export function Vazio({ texto }: { texto: string }) {
  return <div className="p-8 text-center text-slate-400">{texto}</div>
}

export function Titulo({ children, acoes }: { children: ReactNode; acoes?: ReactNode }) {
  return (
    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-sm font-extrabold text-grafite-900">{children}</h1>
      {acoes && <div className="flex flex-wrap gap-1.5">{acoes}</div>}
    </div>
  )
}

/** abre o Bloco com esse id (no celular) e rola até ele; no computador só rola */
export function abrirBloco(id: string, block: ScrollLogicalPosition = 'nearest') {
  window.dispatchEvent(new CustomEvent('abrir-bloco', { detail: id }))
  setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block }), 0)
}

/** bloco com título (card). No computador fica sempre aberto, como um card comum; no celular (abaixo de `lg`) vira
 *  seção recolhível, fechada por padrão, para a tela não ficar longa. O título usa `.label`; `classeTitulo`,
 *  `classeCabecalho` e `icone` reproduzem outros cabeçalhos (cartões do Início, painéis). `extra` vai junto do
 *  título no computador e no topo do conteúdo no celular; `acoes` (busca, botões) só aparecem com a seção aberta. */
export function Bloco({ titulo, icone, contador, extra, acoes, abertoInicial = false, id, className = 'p-2',
  classeTitulo = 'label mb-0', classeCabecalho = 'mb-0.5', children }:
  { titulo: ReactNode; icone?: ReactNode; contador?: number; extra?: ReactNode; acoes?: ReactNode; abertoInicial?: boolean
    id?: string; className?: string; classeTitulo?: string; classeCabecalho?: string; children: ReactNode }) {
  const grande = useTelaGrande()
  const [aberto, setAberto] = useState(abertoInicial)
  useEffect(() => {
    if (!id) return
    const abrir = (e: Event) => { if ((e as CustomEvent).detail === id) setAberto(true) }
    window.addEventListener('abrir-bloco', abrir)
    return () => window.removeEventListener('abrir-bloco', abrir)
  }, [id])
  const nome = <>{icone && <span className="text-lg leading-none">{icone}</span>}<div className={`min-w-0 flex-1 ${classeTitulo}`}>{titulo}{contador != null && ` (${contador})`}{grande && extra}</div></>
  if (grande) return (
    <div id={id} className={`card ${className}`}>
      <div className={`flex items-center gap-2 ${classeCabecalho}`}>{nome}{acoes}</div>
      {children}
    </div>
  )
  return (
    <div id={id} className={`card ${className}`}>
      <div className={`flex items-center gap-2 ${aberto ? classeCabecalho : ''}`}>
        <button type="button" aria-expanded={aberto} className="flex min-h-[2rem] min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setAberto(!aberto)}>
          <span className="w-2.5 shrink-0 text-[10px] text-slate-400" aria-hidden="true">{aberto ? '▼' : '▶'}</span>{nome}
        </button>
        {aberto && acoes}
      </div>
      {/* fechado continua montado (guarda o que foi digitado) e sai na impressão */}
      <div className={aberto ? '' : 'hidden print:block'}>
        {extra && <div className={`mb-1 ${classeTitulo}`}>{extra}</div>}
        {children}
      </div>
    </div>
  )
}

export type CorChip = 'verde' | 'amarelo' | 'vermelho' | 'cinza' | 'azul' | 'roxo'
export function Chip({ cor, children, title }: { cor: CorChip; children: ReactNode; title?: string }) {
  const m: Record<CorChip, string> = {
    verde: 'bg-emerald-100 text-emerald-800', amarelo: 'bg-amber-100 text-amber-800', vermelho: 'bg-red-100 text-red-800',
    cinza: 'bg-slate-100 text-slate-600', azul: 'bg-sky-100 text-sky-800', roxo: 'bg-violet-100 text-violet-800',
  }
  return <span className={`chip whitespace-nowrap ${m[cor]}`} title={title}>{children}</span>
}
