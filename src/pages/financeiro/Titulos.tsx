// Contas a pagar e a receber (títulos, 0003): o compromisso com vencimento; o dinheiro só se move na baixa.
// Parcelamento e repetição na inclusão (lib/titulos), baixa total/parcial com juros e desconto, estorno, cancelamento,
// baixa em lote, documentos anexados, impressão e CSV. Abre um título pela URL ?abrir=<id> (links do Painel).
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase, ok } from '@/lib/supabase'
import { listarCentros, listarContas, listarParceiros, listarPlano, rpc, todas, type ParceiroLista } from '@/lib/dados'
import { fmtData, fmtMoeda, fmtValor, hojeISO, limitesDoMes, mascaraMoeda, mesAtual, normalizar, parsePreco, somar, somarDias } from '@/lib/format'
import { cabecalhoImpressao, escHtml, imprimirHtml } from '@/lib/imprimir'
import { baixarCsv } from '@/lib/csv'
import { nomeDaEmpresa, useDadosEmpresa } from '@/lib/empresa'
import { useAuth } from '@/lib/auth'
import { contemCodigo, movimentoDoTitulo } from '@/lib/planoContas'
import { descricaoParcela, gerarParcelas, REPETICOES, type Repeticao } from '@/lib/titulos'
import { fmtDocumento } from '@/lib/documento'
import {
  COLUNAS_TITULO, FORMAS_PAGAMENTO, SITUACOES_TITULO, ehFinanceiro, ehOperador, soColunas,
  type Anexo, type CentroCusto, type ContaFinanceira, type FormaPagamento, type Lancamento, type PlanoConta, type SituacaoTitulo, type Titulo, type TipoTitulo,
} from '@/lib/types'
import { BotaoAtualizar, Campo, Carregando, Chip, Confirmar, Modal, Opcoes, Progresso, Titulo as TituloTela, useToast, Vazio } from '@/components/ui'
import ComboParceiro from '@/components/ComboParceiro'
import OpcoesPlano from '@/components/OpcoesPlano'
import NovoPlanoConta from '@/components/NovoPlanoConta'
import Anexos, { apagarArquivos, gravarAnexos, listarAnexos } from '@/components/Anexos'
import BaixaTitulo from '@/components/BaixaTitulo'
import { cadastrarParceiroRapido } from '@/components/FormLancamento'

type Filtro = 'ABERTOS' | 'VENCIDOS' | 'QUITADOS' | 'CANCELADOS' | 'TODOS'
const FILTROS: Record<Filtro, string> = { ABERTOS: 'Em aberto', VENCIDOS: 'Vencidos', QUITADOS: 'Quitados', CANCELADOS: 'Cancelados', TODOS: 'Todos' }
const COR_SITUACAO: Record<SituacaoTitulo, 'azul' | 'amarelo' | 'verde' | 'cinza'> = { ABERTO: 'azul', PARCIAL: 'amarelo', PAGO: 'verde', CANCELADO: 'cinza' }
const aberto = (t: Titulo) => t.situacao === 'ABERTO' || t.situacao === 'PARCIAL'

interface Cadastros { planos: PlanoConta[]; centros: CentroCusto[]; contas: ContaFinanceira[]; parceiros: ParceiroLista[] }

export default function Titulos({ tipo }: { tipo: TipoTitulo }) {
  const empresa = useDadosEmpresa()
  const { perfil } = useAuth()
  const { toast } = useToast()
  const [params, setParams] = useSearchParams()
  const pagar = tipo === 'PAGAR'
  const nome = pagar ? 'Contas a pagar' : 'Contas a receber'
  const [lista, setLista] = useState<Titulo[] | null>(null)
  const [abertos, setAbertos] = useState<Titulo[]>([])
  const [cad, setCad] = useState<Cadastros>({ planos: [], centros: [], contas: [], parceiros: [] })
  const [filtro, setFiltro] = useState<Filtro>('ABERTOS')
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [texto, setTexto] = useState('')
  const [planoF, setPlanoF] = useState('')
  const [centroF, setCentroF] = useState('')
  // ?parceiro=<id>: lista já filtrada por um cliente/fornecedor (link da tela Clientes e fornecedores)
  const [parceiroF, setParceiroF] = useState<number | null>(Number(params.get('parceiro')) || null)
  const [edit, setEdit] = useState<Partial<Titulo> | null>(null)
  const [baixar, setBaixar] = useState<Titulo | null>(null)
  const [marcados, setMarcados] = useState<Set<number>>(new Set())
  const [lote, setLote] = useState(false)
  const hoje = hojeISO()

  function escolherFiltro(f: Filtro) {
    setFiltro(f); setMarcados(new Set())
    if (f === 'QUITADOS') { const m = limitesDoMes(mesAtual()); setDe(m.de); setAte(m.ate) } else if (filtro === 'QUITADOS') { setDe(''); setAte('') }
  }

  async function carregar() {
    try {
      const l = await todas<Titulo>((a, b) => {
        let q = supabase.from('v_titulo').select('*').eq('tipo', tipo)
        if (filtro === 'ABERTOS' || filtro === 'VENCIDOS') q = q.in('situacao', ['ABERTO', 'PARCIAL'])
        if (filtro === 'VENCIDOS') q = q.lt('vencimento', hoje)
        if (filtro === 'QUITADOS') q = q.eq('situacao', 'PAGO')
        if (filtro === 'CANCELADOS') q = q.eq('cancelado', true)
        const campo = filtro === 'QUITADOS' ? 'pago_em' : 'vencimento'
        if (de) q = q.gte(campo, de)
        if (ate) q = q.lte(campo, ate)
        return q.order(campo, { ascending: filtro !== 'QUITADOS' }).order('id').range(a, b)
      })
      setLista(l)
      // os cartões sempre mostram o que está em aberto (qualquer que seja o filtro da lista)
      setAbertos(filtro === 'ABERTOS' && !de && !ate ? l : await todas<Titulo>((a, b) => supabase.from('v_titulo').select('*').eq('tipo', tipo).in('situacao', ['ABERTO', 'PARCIAL']).order('vencimento').order('id').range(a, b)))
    } catch (e: any) { toast(e.message, 'erro'); setLista([]) }
  }
  const carregarCadastros = () => Promise.all([listarPlano(false), listarCentros(false), listarContas(false), listarParceiros()])
    .then(([planos, centros, contas, parceiros]) => setCad({ planos, centros, contas, parceiros })).catch((e) => toast(e.message, 'erro'))
  useEffect(() => { carregar() }, [tipo, filtro, de, ate])
  useEffect(() => { carregarCadastros() }, [])
  useEffect(() => { const p = Number(params.get('parceiro')) || null; if (p) setParceiroF(p) }, [params])
  function limparParceiro() { setParceiroF(null); params.delete('parceiro'); setParams(params, { replace: true }) }
  const nomeParceiroF = parceiroF ? (() => { const p = cad.parceiros.find((x) => x.id === parceiroF); return p ? p.nome_fantasia || p.nome : `#${parceiroF}` })() : ''
  // ?abrir=<id>: abre a ficha do título (links do Painel)
  useEffect(() => {
    const id = Number(params.get('abrir'))
    if (!id) return
    Promise.resolve(supabase.from('v_titulo').select('*').eq('id', id).maybeSingle())
      .then((r) => { const t = ok(r) as Titulo | null; if (t) setEdit(t); else toast('Título não encontrado', 'erro') })
      .catch((e) => toast(e.message, 'erro'))
      .finally(() => { params.delete('abrir'); setParams(params, { replace: true }) })
  }, [params])

  const visiveis = useMemo(() => {
    const t = normalizar(texto.trim())
    const plano = cad.planos.find((c) => String(c.id) === planoF)
    return (lista ?? []).filter((x) => (!plano || (x.plano_codigo != null && contemCodigo(plano, x.plano_codigo)))
      && (!centroF || String(x.centro_custo_id ?? '') === centroF)
      && (!parceiroF || x.parceiro_id === parceiroF)
      && (!t || normalizar(`${x.descricao} ${x.parceiro ?? ''} ${x.documento ?? ''} ${x.parceiro_documento ?? ''}`).includes(t)))
  }, [lista, cad.planos, texto, planoF, centroF, parceiroF])
  const cartoes = useMemo(() => {
    const base = parceiroF ? abertos.filter((t) => t.parceiro_id === parceiroF) : abertos
    const s = (f: (t: Titulo) => boolean) => { const l = base.filter(f); return { valor: somar(l.map((t) => t.saldo)), qtd: l.length } }
    return { total: s(() => true), vencido: s((t) => t.vencimento < hoje), hoje: s((t) => t.vencimento === hoje), semana: s((t) => t.vencimento > hoje && t.vencimento <= somarDias(hoje, 7)) }
  }, [abertos, hoje, parceiroF])
  const podeEscrever = ehOperador(perfil)
  const selecionaveis = visiveis.filter(aberto)
  const marcadosLista = selecionaveis.filter((t) => marcados.has(t.id))
  const alternar = (id: number) => setMarcados((m) => { const s = new Set(m); if (s.has(id)) s.delete(id); else s.add(id); return s })

  const periodoTexto = de || ate ? `${filtro === 'QUITADOS' ? 'Pagamento' : 'Vencimento'} ${de ? `de ${fmtData(de)} ` : ''}${ate ? `até ${fmtData(ate)}` : ''}` : ''
  function imprimir() {
    const linhas = visiveis.map((t) => `<tr><td>${fmtData(t.vencimento)}</td><td>${escHtml(descricaoParcela(t.descricao, t.parcela, t.parcelas))}</td><td>${escHtml(t.parceiro)}</td><td>${escHtml(t.plano)}</td><td>${escHtml(t.documento)}</td><td class="num">${fmtValor(t.valor)}</td><td class="num">${fmtValor(t.valor_pago)}</td><td class="num">${fmtValor(t.saldo)}</td><td>${escHtml(t.vencido ? `Vencido ${t.dias_atraso}d` : SITUACOES_TITULO[t.situacao])}</td></tr>`).join('')
    imprimirHtml(nome, `${cabecalhoImpressao(nomeDaEmpresa(empresa), nome, [FILTROS[filtro], periodoTexto, nomeParceiroF].filter(Boolean).join(' · '))}
      <table class="tabela"><thead><tr><th>Vencimento</th><th>Descrição</th><th>${pagar ? 'Fornecedor' : 'Cliente'}</th><th>Conta do plano</th><th>Documento</th><th class="num">Valor</th><th class="num">${pagar ? 'Pago' : 'Recebido'}</th><th class="num">Saldo</th><th>Situação</th></tr></thead>
      <tbody class="zebra">${linhas}</tbody><tfoot><tr><td colspan="5">${visiveis.length} título(s)</td><td class="num">${fmtValor(somar(visiveis.map((t) => t.valor)))}</td><td class="num">${fmtValor(somar(visiveis.map((t) => t.valor_pago)))}</td><td class="num">${fmtValor(somar(visiveis.map((t) => t.saldo)))}</td><td></td></tr></tfoot></table>`, 'landscape')
  }
  function exportar() {
    baixarCsv(`${pagar ? 'contas-a-pagar' : 'contas-a-receber'}-${hoje}`, ['Vencimento', 'Competência', 'Descrição', 'Parcela', pagar ? 'Fornecedor' : 'Cliente', 'CPF/CNPJ', 'Grupo', 'Conta do plano', 'Centro de custo', 'Documento', 'Emissão', 'Valor', pagar ? 'Pago' : 'Recebido', 'Saldo', 'Situação', 'Pago em', 'Dias de atraso'],
      visiveis.map((t) => [fmtData(t.vencimento), t.competencia.slice(0, 7), t.descricao, t.parcelas ? `${t.parcela}/${t.parcelas}` : '', t.parceiro, fmtDocumento(t.parceiro_documento), t.plano_raiz, t.plano, t.centro_custo,
        t.documento, fmtData(t.emissao), t.valor, t.valor_pago, t.saldo, SITUACOES_TITULO[t.situacao], fmtData(t.pago_em), t.dias_atraso || '']))
  }

  if (!lista) return <Carregando />
  const Cartao = ({ rotulo, v, cor, f }: { rotulo: string; v: { valor: number; qtd: number }; cor: string; f?: Filtro }) => (
    <button type="button" className={`card border-l-4 ${cor} px-3 py-1.5 text-left hover:bg-slate-50`} onClick={() => f && escolherFiltro(f)}>
      <div className="text-[10px] font-bold uppercase text-slate-500">{rotulo}</div>
      <div className="text-sm font-extrabold tabular-nums">{fmtMoeda(v.valor)} <span className="text-[11px] font-normal text-slate-400">{v.qtd} título(s)</span></div>
    </button>
  )
  return (
    <div className="flex h-full flex-col">
      <div className="barra">
        <TituloTela>{nome}</TituloTela>
        <BotaoAtualizar onClick={() => { carregar(); carregarCadastros() }} />
        <div className="flex overflow-hidden rounded-md border border-slate-300">
          {(Object.keys(FILTROS) as Filtro[]).map((f) => (
            <button key={f} className={`px-2 py-1 font-semibold ${filtro === f ? 'bg-grafite-900 text-white' : 'bg-white text-slate-600'}`} onClick={() => escolherFiltro(f)}>{FILTROS[f]}</button>
          ))}
        </div>
        <Campo label={filtro === 'QUITADOS' ? 'Pago de' : 'Vence de'}><input className="input" type="date" value={de} onChange={(e) => setDe(e.target.value)} /></Campo>
        <Campo label="até"><input className="input" type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></Campo>
        <Campo label="Conta do plano">
          <select className="input" value={planoF} onChange={(e) => setPlanoF(e.target.value)}>
            <option value="">Todas</option>{cad.planos.filter((c) => c.tipo === movimentoDoTitulo(tipo)).map((c) => <option key={c.id} value={c.id}>{'  '.repeat(c.nivel - 1)}{c.nome}</option>)}
          </select>
        </Campo>
        {cad.centros.length > 0 && (
          <Campo label="Centro">
            <select className="input" value={centroF} onChange={(e) => setCentroF(e.target.value)}>
              <option value="">Todos</option>{cad.centros.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </Campo>
        )}
        <Campo label="Buscar"><input className="input" type="text" placeholder={`descrição, ${pagar ? 'fornecedor' : 'cliente'}, documento…`} value={texto} onChange={(e) => setTexto(e.target.value)} /></Campo>
        {parceiroF && (
          <button type="button" className="chip bg-laranja-100 text-laranja-800" title="Limpar o filtro" onClick={limparParceiro}>
            {pagar ? 'Fornecedor' : 'Cliente'}: {nomeParceiroF} ✕
          </button>
        )}
        <div className="ml-auto flex gap-1.5">
          {podeEscrever && marcadosLista.length > 0 && <button className="btn-accent" onClick={() => setLote(true)}>✓ {pagar ? 'Pagar' : 'Receber'} {marcadosLista.length} selecionado(s)</button>}
          <button className="btn-secondary" title="Imprimir" onClick={imprimir}>🖨️</button>
          <button className="btn-secondary" title="Exportar para planilha (CSV)" onClick={exportar}>⬇️ CSV</button>
          {podeEscrever && <button className="btn-primary" onClick={() => setEdit({ tipo, vencimento: hoje, emissao: hoje, conta_prevista_id: cad.contas.find((c) => c.ativa && c.tipo === 'CONTA_CORRENTE')?.id ?? null })}>+ Nova conta a {pagar ? 'pagar' : 'receber'}</button>}
        </div>
      </div>
      <div className="mb-1.5 grid grid-cols-2 gap-1.5 lg:grid-cols-4">
        <Cartao rotulo="Em aberto" v={cartoes.total} cor="border-l-grafite-700" f="ABERTOS" />
        <Cartao rotulo="Vencido" v={cartoes.vencido} cor="border-l-red-600" f="VENCIDOS" />
        <Cartao rotulo="Vence hoje" v={cartoes.hoje} cor="border-l-laranja-500" />
        <Cartao rotulo="Próximos 7 dias" v={cartoes.semana} cor="border-l-amber-400" />
      </div>
      <div className="card flex-1 min-h-0 overflow-auto">
        {visiveis.length === 0 ? <Vazio texto={`Nenhuma conta a ${pagar ? 'pagar' : 'receber'} neste filtro`} /> : (
          <table className="tabela">
            <thead><tr>
              {podeEscrever && <th className="w-6"><input type="checkbox" title="Selecionar os em aberto" checked={selecionaveis.length > 0 && marcadosLista.length === selecionaveis.length}
                onChange={(e) => setMarcados(e.target.checked ? new Set(selecionaveis.map((t) => t.id)) : new Set())} /></th>}
              <th>Vencimento</th><th>Descrição</th><th>{pagar ? 'Fornecedor' : 'Cliente'}</th><th>Conta do plano</th><th>Documento</th><th className="num">Valor</th><th className="num">{pagar ? 'Pago' : 'Recebido'}</th><th className="num">Saldo</th><th>Situação</th>
            </tr></thead>
            <tbody>
              {visiveis.map((t) => (
                <tr key={t.id} className={`cursor-pointer hover:bg-grafite-50 ${t.situacao === 'CANCELADO' ? 'text-slate-400 line-through' : ''}`} onClick={() => setEdit(t)}>
                  {podeEscrever && <td onClick={(e) => e.stopPropagation()}>{aberto(t) && <input type="checkbox" checked={marcados.has(t.id)} onChange={() => alternar(t.id)} />}</td>}
                  <td className={`whitespace-nowrap ${t.vencido ? 'font-bold text-red-700' : t.vencimento === hoje && aberto(t) ? 'font-bold text-laranja-700' : ''}`}>
                    {fmtData(t.vencimento)}{t.vencido && <span className="ml-1 text-[10px] font-semibold">{t.dias_atraso}d</span>}
                  </td>
                  <td className="max-w-[280px] truncate" title={t.observacao ?? t.descricao}>{descricaoParcela(t.descricao, t.parcela, t.parcelas)}{!!t.anexos && <span className="ml-1 text-[10px] text-slate-500" title={`${t.anexos} documento(s)`}>📎{t.anexos > 1 ? t.anexos : ''}</span>}</td>
                  <td className="max-w-[200px] truncate">{t.parceiro}</td>
                  <td className="max-w-[180px] truncate">{t.plano}</td>
                  <td>{t.documento}</td>
                  <td className="num">{fmtValor(t.valor)}</td>
                  <td className="num text-slate-500">{t.valor_pago > 0 ? fmtValor(t.valor_pago) : ''}</td>
                  <td className="num font-semibold">{aberto(t) ? fmtValor(t.saldo) : ''}</td>
                  <td>{t.vencido ? <Chip cor="vermelho">vencido</Chip> : <Chip cor={COR_SITUACAO[t.situacao]}>{SITUACOES_TITULO[t.situacao]}</Chip>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr>
              <td colSpan={podeEscrever ? 6 : 5}>{visiveis.length} título(s)</td>
              <td className="num">{fmtValor(somar(visiveis.map((t) => t.valor)))}</td>
              <td className="num">{fmtValor(somar(visiveis.map((t) => t.valor_pago)))}</td>
              <td className="num">{fmtValor(somar(visiveis.filter(aberto).map((t) => t.saldo)))}</td><td></td>
            </tr></tfoot>
          </table>
        )}
      </div>
      {edit && <FormTitulo inicial={edit} tipo={tipo} cad={cad} onCadastros={carregarCadastros}
        onBaixar={(t) => setBaixar(t)} onFechar={(mudou) => { setEdit(null); if (mudou) carregar() }} />}
      {baixar && <BaixaTitulo titulo={baixar} contas={cad.contas} onFechar={(baixou) => {
        const id = baixar.id
        setBaixar(null)
        if (!baixou) return
        carregar()
        // ficha aberta: recarrega o título com o novo saldo
        if (edit?.id === id) Promise.resolve(supabase.from('v_titulo').select('*').eq('id', id).maybeSingle()).then((r) => r.data && setEdit({ ...(r.data as Titulo) }))
      }} />}
      {lote && <BaixaLote titulos={marcadosLista} contas={cad.contas} pagar={pagar} onFechar={(mudou) => { setLote(false); if (mudou) { setMarcados(new Set()); carregar() } }} />}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Ficha do título
// ---------------------------------------------------------------------------------------------------------------
interface Baixa { baixa_id: string; data: string; conta: string | null; principal: number; juros: number; desconto: number; total: number; forma: string | null }

function FormTitulo({ inicial, tipo, cad, onCadastros, onBaixar, onFechar }: {
  inicial: Partial<Titulo>; tipo: TipoTitulo; cad: Cadastros; onCadastros: () => Promise<unknown>
  onBaixar: (t: Titulo) => void; onFechar: (mudou: boolean) => void
}) {
  const { toast } = useToast()
  const { perfil } = useAuth()
  const pagar = tipo === 'PAGAR'
  const mov = movimentoDoTitulo(tipo)
  const existente = !!inicial.id
  const podeEscrever = ehOperador(perfil)
  const [t, setT] = useState<Partial<Titulo>>(inicial)
  const [valorTxt, setValorTxt] = useState(inicial.valor ? fmtValor(inicial.valor) : '')
  const [competencia, setCompetencia] = useState((inicial.competencia ?? inicial.vencimento ?? hojeISO()).slice(0, 7))
  const [compManual, setCompManual] = useState(existente && (inicial.competencia ?? '').slice(0, 7) !== (inicial.vencimento ?? '').slice(0, 7))
  const [repeticao, setRepeticao] = useState<Repeticao>('NAO')
  const [vezes, setVezes] = useState(2)
  const [anexos, setAnexos] = useState<Anexo[]>([])
  const [novos, setNovos] = useState<File[]>([])
  const [sair, setSair] = useState<Set<number>>(new Set())
  const [baixas, setBaixas] = useState<Baixa[]>([])
  const [mudou, setMudou] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [novoPlano, setNovoPlano] = useState(false)
  const [estornar, setEstornar] = useState<Baixa | null>(null)
  const [excluir, setExcluir] = useState(false)
  const [cancelar, setCancelar] = useState<string | null>(null)
  const pago = Number(t.valor_pago ?? 0)
  const editavel = podeEscrever && t.situacao !== 'CANCELADO'

  useEffect(() => { setT(inicial); setValorTxt(inicial.valor ? fmtValor(inicial.valor) : '') }, [inicial])
  async function carregarBaixas() {
    if (!inicial.id) return
    const l = ok(await supabase.from('v_lancamento').select('*').eq('titulo_id', inicial.id).order('data').order('id')) as Lancamento[]
    const m = new Map<string, Baixa>()
    for (const x of l) {
      const b = m.get(x.baixa_id!) ?? { baixa_id: x.baixa_id!, data: x.data, conta: x.conta ?? null, principal: 0, juros: 0, desconto: 0, total: 0, forma: x.forma }
      if (x.titulo_papel === 'PRINCIPAL') b.principal = somar([b.principal, x.valor])
      else if (x.titulo_papel === 'JUROS') b.juros = somar([b.juros, x.valor])
      else b.desconto = somar([b.desconto, x.valor])
      b.total = somar([b.principal, b.juros, -b.desconto])
      m.set(b.baixa_id, b)
    }
    setBaixas([...m.values()])
  }
  useEffect(() => {
    if (!inicial.id) return
    listarAnexos({ titulo_id: inicial.id }).then(setAnexos).catch((e) => toast(e.message, 'erro'))
    carregarBaixas().catch((e) => toast(e.message, 'erro'))
  }, [inicial.id, inicial.valor_pago])

  function mudarVencimento(v: string) {
    setT({ ...t, vencimento: v })
    if (!compManual && v) setCompetencia(v.slice(0, 7))
  }
  async function novoParceiro(nome: string) {
    try { const id = await cadastrarParceiroRapido(nome, pagar ? 'FORNECEDOR' : 'CLIENTE'); await onCadastros(); setT((x) => ({ ...x, parceiro_id: id })); toast(`${nome} cadastrado`) }
    catch (e: any) { toast(e.message, 'erro') }
  }

  async function salvar() {
    if (salvando) return
    const valor = parsePreco(valorTxt)
    if (!t.descricao?.trim()) { toast('Informe a descrição', 'erro'); return }
    if (!t.vencimento) { toast('Informe o vencimento', 'erro'); return }
    if (!valor || valor <= 0) { toast('Informe o valor', 'erro'); return }
    if (!t.plano_conta_id) { toast('Escolha a conta do plano', 'erro'); return }
    if (existente && valor < pago) { toast(`O valor não pode ficar menor que o já ${pagar ? 'pago' : 'recebido'} (${fmtMoeda(pago)})`, 'erro'); return }
    setSalvando(true)
    try {
      const base = { ...t, tipo, valor, descricao: t.descricao.trim(), competencia: `${competencia}-01`, emissao: t.emissao || null, documento: t.documento || null,
        codigo_barras: t.codigo_barras || null, observacao: t.observacao || null, forma_prevista: t.forma_prevista || null }
      let id: number
      if (existente) {
        ok(await supabase.from('titulo').update(soColunas(base as Titulo, COLUNAS_TITULO)).eq('id', t.id!))
        id = t.id!
      } else {
        const parcelas = gerarParcelas(valor, t.vencimento, repeticao, vezes)
        const grupo = parcelas.length > 1 ? crypto.randomUUID() : null
        const linhas = parcelas.map((p) => soColunas({ ...base, ...p, grupo_id: grupo, competencia: compManual && parcelas.length === 1 ? `${competencia}-01` : p.competencia } as Titulo, COLUNAS_TITULO))
        const criados = ok(await supabase.from('titulo').insert(linhas).select('id').order('id')) as { id: number }[]
        id = criados[0].id
        if (parcelas.length > 1) toast(`${parcelas.length} títulos criados (${REPETICOES[repeticao].split(' (')[0].toLowerCase()})`, 'info')
      }
      setMudou(true)
      const erros = novos.length || sair.size ? await gravarAnexos({ titulo_id: id }, novos, anexos.filter((a) => sair.has(a.id))) : []
      if (erros.length) {
        toast(`Título salvo, mas ${erros.length} documento(s) falharam: ${erros.join('; ')}`, 'erro')
        const r = ok(await supabase.from('v_titulo').select('*').eq('id', id).single()) as Titulo
        setT(r); setNovos(novos.filter((f) => erros.some((e) => e.startsWith(f.name)))); setSair(new Set())
        setAnexos(await listarAnexos({ titulo_id: id }).catch(() => anexos))
        return
      }
      toast('Título salvo'); onFechar(true)
    } catch (e: any) { toast(e.message, 'erro') } finally { setSalvando(false) }
  }
  async function confirmarEstorno() {
    if (!estornar) return
    const b = estornar
    setEstornar(null)
    try {
      await rpc('estornar_baixa', { p_baixa_id: b.baixa_id })
      toast('Baixa estornada'); setMudou(true)
      const r = ok(await supabase.from('v_titulo').select('*').eq('id', t.id!).single()) as Titulo
      setT(r); await carregarBaixas()
    } catch (e: any) { toast(e.message, 'erro') }
  }
  async function confirmarExcluir() {
    setExcluir(false)
    try {
      ok(await supabase.from('titulo').delete().eq('id', t.id!))
      await apagarArquivos(anexos)
      toast('Título excluído'); onFechar(true)
    } catch (e: any) { toast(e.message, 'erro') }
  }
  async function alternarCancelado(cancelado: boolean, motivo?: string) {
    try {
      ok(await supabase.from('titulo').update({ cancelado, cancelado_motivo: cancelado ? motivo?.trim() || null : null }).eq('id', t.id!))
      toast(cancelado ? 'Título cancelado' : 'Título reativado'); onFechar(true)
    } catch (e: any) { toast(e.message, 'erro') }
  }

  const prevParcelas = !existente && repeticao !== 'NAO' && parsePreco(valorTxt) && t.vencimento ? gerarParcelas(parsePreco(valorTxt)!, t.vencimento, repeticao, vezes) : []
  const tituloModal = existente ? `${pagar ? 'Conta a pagar' : 'Conta a receber'} #${t.id}${t.parcelas ? ` · parcela ${t.parcela}/${t.parcelas}` : ''}` : `Nova conta a ${pagar ? 'pagar' : 'receber'}`
  return (
    <Modal aberto titulo={tituloModal} onFechar={() => onFechar(mudou)}>
      <div className="mx-auto max-w-4xl">
        {existente && (
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-grafite-50 px-3 py-2 text-xs">
            {t.vencido ? <Chip cor="vermelho">vencido há {t.dias_atraso} dia(s)</Chip> : <Chip cor={COR_SITUACAO[t.situacao!]}>{SITUACOES_TITULO[t.situacao!]}</Chip>}
            <span>Valor <b className="tabular-nums">{fmtMoeda(t.valor)}</b></span>
            {pago > 0 && <span>{pagar ? 'Pago' : 'Recebido'} <b className="tabular-nums">{fmtMoeda(pago)}</b>{t.pago_em && ` em ${fmtData(t.pago_em)}`}</span>}
            {t.situacao !== 'CANCELADO' && <span>Saldo <b className="tabular-nums">{fmtMoeda(t.saldo)}</b></span>}
            {t.cancelado_motivo && <span className="text-slate-500">Motivo do cancelamento: {t.cancelado_motivo}</span>}
            <span className="ml-auto flex gap-1.5">
              {podeEscrever && (t.situacao === 'ABERTO' || t.situacao === 'PARCIAL') && <button className="btn-accent" onClick={() => onBaixar(t as Titulo)}>✓ {pagar ? 'Pagar' : 'Receber'}</button>}
            </span>
          </div>
        )}
        <div className="ficha grid grid-cols-1 gap-2 sm:grid-cols-4">
          <Campo label={pagar ? 'Fornecedor' : 'Cliente'} className="sm:col-span-2">
            {editavel ? <ComboParceiro parceiros={cad.parceiros} valor={t.parceiro_id ?? null} tipo={pagar ? 'FORNECEDOR' : 'CLIENTE'} onChange={(id) => setT({ ...t, parceiro_id: id })} onNovo={novoParceiro} autoFocus={!existente} />
              : <div className="input bg-slate-100">{t.parceiro ?? '—'}</div>}
          </Campo>
          <Campo label="Descrição" className="sm:col-span-2"><input className="input" disabled={!editavel} value={t.descricao ?? ''} onChange={(e) => setT({ ...t, descricao: e.target.value })} placeholder={pagar ? 'ex.: Aluguel da loja' : 'ex.: Serviço de consultoria'} /></Campo>
          <Campo label="Valor (R$)"><input className="input text-right font-semibold" inputMode="decimal" disabled={!editavel} value={valorTxt} onChange={(e) => setValorTxt(mascaraMoeda(e.target.value))} /></Campo>
          <Campo label="Vencimento"><input className="input" type="date" disabled={!editavel} value={t.vencimento ?? ''} onChange={(e) => mudarVencimento(e.target.value)} /></Campo>
          <Campo label="Competência (mês da DRE)"><input className="input" type="month" disabled={!editavel} value={competencia} onChange={(e) => { if (e.target.value) { setCompetencia(e.target.value); setCompManual(true) } }} /></Campo>
          <Campo label="Emissão"><input className="input" type="date" disabled={!editavel} value={t.emissao ?? ''} onChange={(e) => setT({ ...t, emissao: e.target.value || null })} /></Campo>
          <Campo label="Conta do plano" className="sm:col-span-2">
            <div className="flex gap-1">
              <select className="input" disabled={!editavel} value={t.plano_conta_id ?? ''} onChange={(e) => setT({ ...t, plano_conta_id: e.target.value ? Number(e.target.value) : undefined })}>
                <option value="">— escolha —</option>
                <OpcoesPlano planos={cad.planos} filtro={(c) => c.tipo === mov} atual={t.plano_conta_id} />
              </select>
              {editavel && ehFinanceiro(perfil) && <button type="button" className="btn-secondary px-2" title="Nova conta no plano" onClick={() => setNovoPlano(true)}>+</button>}
            </div>
          </Campo>
          <Campo label="Centro de custo">
            <select className="input" disabled={!editavel} value={t.centro_custo_id ?? ''} onChange={(e) => setT({ ...t, centro_custo_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">—</option>{cad.centros.filter((c) => c.ativo || c.id === t.centro_custo_id).map((c) => <option key={c.id} value={c.id}>{c.codigo ? `${c.codigo} · ` : ''}{c.nome}</option>)}
            </select>
          </Campo>
          <Campo label="Documento (NF, boleto)"><input className="input" disabled={!editavel} value={t.documento ?? ''} onChange={(e) => setT({ ...t, documento: e.target.value })} /></Campo>
          <Campo label={`Conta prevista para ${pagar ? 'pagar' : 'receber'}`} className="sm:col-span-2">
            <select className="input" disabled={!editavel} value={t.conta_prevista_id ?? ''} onChange={(e) => setT({ ...t, conta_prevista_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">—</option>{cad.contas.filter((c) => c.ativa || c.id === t.conta_prevista_id).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </Campo>
          <Campo label="Forma prevista" className="sm:col-span-2"><Opcoes valor={t.forma_prevista} opcoes={FORMAS_PAGAMENTO} vazio="—" disabled={!editavel} onChange={(v) => setT({ ...t, forma_prevista: (v || null) as FormaPagamento | null })} /></Campo>
          <Campo label="Código de barras / PIX copia e cola" className="sm:col-span-4">
            <div className="flex gap-1">
              <input className="input font-mono text-xs" disabled={!editavel} value={t.codigo_barras ?? ''} onChange={(e) => setT({ ...t, codigo_barras: e.target.value })} />
              {t.codigo_barras && <button type="button" className="btn-secondary" title="Copiar" onClick={() => navigator.clipboard?.writeText(t.codigo_barras!).then(() => toast('Copiado', 'info')).catch(() => {})}>📋</button>}
            </div>
          </Campo>
          <Campo label="Observação" className="sm:col-span-4"><textarea className="input" rows={2} disabled={!editavel} value={t.observacao ?? ''} onChange={(e) => setT({ ...t, observacao: e.target.value })} /></Campo>
          {!existente && (
            <>
              <Campo label="Repetição" className="sm:col-span-2"><Opcoes valor={repeticao} opcoes={REPETICOES} vazio={null} onChange={(v) => setRepeticao((v || 'NAO') as Repeticao)} /></Campo>
              {repeticao !== 'NAO' && <Campo label={repeticao === 'PARCELAR' ? 'Número de parcelas' : 'Quantos meses'}><input className="input" type="number" min={2} max={120} value={vezes} onChange={(e) => setVezes(Math.min(120, Math.max(2, Number(e.target.value) || 2)))} /></Campo>}
              {prevParcelas.length > 1 && (
                <div className="sm:col-span-4 rounded bg-sky-50 px-2 py-1 text-[11px] text-sky-900">
                  {prevParcelas.length} títulos: {prevParcelas.slice(0, 4).map((p) => `${p.parcela}/${p.parcelas} ${fmtData(p.vencimento)} ${fmtMoeda(p.valor)}`).join(' · ')}{prevParcelas.length > 4 ? ' · …' : ''}
                  {novos.length > 0 && ' · os documentos vão no primeiro título'}
                </div>
              )}
            </>
          )}
          <div className="sm:col-span-4"><Anexos atuais={anexos} sair={sair} novos={novos} onNovos={setNovos} onSair={setSair} somenteLeitura={!podeEscrever} /></div>
          {existente && (
            <div className="sm:col-span-4 rounded-lg border border-slate-200 p-2">
              <div className="label">{pagar ? 'Pagamentos' : 'Recebimentos'} (baixas)</div>
              {baixas.length === 0 ? <div className="text-xs text-slate-400">Nenhuma baixa ainda.</div> : (
                <table className="tabela">
                  <thead><tr><th>Data</th><th>Conta</th><th>Forma</th><th className="num">Principal</th><th className="num">Juros/multa</th><th className="num">Desconto</th><th className="num">{pagar ? 'Saiu' : 'Entrou'}</th><th></th></tr></thead>
                  <tbody>
                    {baixas.map((b) => (
                      <tr key={b.baixa_id}>
                        <td>{fmtData(b.data)}</td><td>{b.conta}</td><td>{b.forma ? FORMAS_PAGAMENTO[b.forma as FormaPagamento] : ''}</td>
                        <td className="num">{fmtValor(b.principal)}</td><td className="num">{b.juros ? fmtValor(b.juros) : ''}</td><td className="num">{b.desconto ? fmtValor(b.desconto) : ''}</td>
                        <td className="num font-semibold">{fmtValor(b.total)}</td>
                        <td className="text-right">{ehFinanceiro(perfil) && <button className="btn-secondary py-0 text-[11px]" onClick={() => setEstornar(b)}>Estornar</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
          <div className="acoes sm:col-span-4 flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex gap-1.5">
              {existente && ehFinanceiro(perfil) && pago === 0 && <button className="btn-danger" onClick={() => setExcluir(true)}>Excluir</button>}
              {existente && podeEscrever && pago === 0 && t.situacao !== 'CANCELADO' && <button className="btn-secondary" onClick={() => setCancelar('')}>Cancelar título</button>}
              {existente && podeEscrever && t.situacao === 'CANCELADO' && <button className="btn-secondary" onClick={() => alternarCancelado(false)}>Reativar</button>}
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={() => onFechar(mudou)}>{mudou || !editavel ? 'Fechar' : 'Cancelar'}</button>
              {editavel && <button className="btn-primary" disabled={salvando} onClick={salvar}>{!existente && prevParcelas.length > 1 ? `Salvar ${prevParcelas.length} títulos` : 'Salvar'}</button>}
            </div>
          </div>
        </div>
      </div>
      {novoPlano && <NovoPlanoConta lista={cad.planos} tipo={mov} onFechar={async (criada) => {
        setNovoPlano(false)
        if (criada) { await onCadastros(); if (criada.nivel > 1) setT((x) => ({ ...x, plano_conta_id: criada.id })) }
      }} />}
      <Confirmar aberto={!!estornar} perigo titulo="Estornar baixa" texto={`Estornar a baixa de ${fmtData(estornar?.data)} (${fmtMoeda(estornar?.total)})? Os lançamentos dela saem da conta e o título volta a ficar em aberto. Se a baixa veio da conciliação, a linha do extrato volta para os pendentes.`}
        onNao={() => setEstornar(null)} onSim={confirmarEstorno} />
      <Confirmar aberto={excluir} perigo titulo="Excluir título" texto={`Excluir "${t.descricao}" de ${fmtMoeda(t.valor)}? Os documentos anexados também saem.`} onNao={() => setExcluir(false)} onSim={confirmarExcluir} />
      <Modal aberto={cancelar !== null} titulo="Cancelar título" onFechar={() => setCancelar(null)} largura="max-w-md">
        <div className="ficha grid gap-2">
          <p className="text-sm text-slate-600">O título cancelado sai das contas em aberto, do fluxo de caixa e da DRE, mas continua registrado.</p>
          <Campo label="Motivo"><input className="input" autoFocus value={cancelar ?? ''} onChange={(e) => setCancelar(e.target.value)} placeholder="ex.: nota cancelada pelo fornecedor" /></Campo>
          <div className="acoes flex justify-end gap-2"><button className="btn-secondary" onClick={() => setCancelar(null)}>Voltar</button><button className="btn-danger" onClick={() => { const m = cancelar; setCancelar(null); alternarCancelado(true, m ?? '') }}>Cancelar título</button></div>
        </div>
      </Modal>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Baixa em lote: o saldo de cada título selecionado, com a mesma data e conta
// ---------------------------------------------------------------------------------------------------------------
function BaixaLote({ titulos, contas, pagar, onFechar }: { titulos: Titulo[]; contas: ContaFinanceira[]; pagar: boolean; onFechar: (mudou: boolean) => void }) {
  const { toast } = useToast()
  const [data, setData] = useState(hojeISO())
  const [contaId, setContaId] = useState<number | ''>(contas.find((c) => c.ativa && c.tipo === 'CONTA_CORRENTE')?.id ?? contas.find((c) => c.ativa)?.id ?? '')
  const [forma, setForma] = useState<FormaPagamento | ''>('')
  const [feitos, setFeitos] = useState<number | null>(null)
  const [erros, setErros] = useState<string[]>([])
  const total = somar(titulos.map((t) => t.saldo))
  async function executar() {
    if (!data || !contaId) { toast('Informe a data e a conta', 'erro'); return }
    const e: string[] = []
    setFeitos(0)
    for (let i = 0; i < titulos.length; i++) {
      const t = titulos[i]
      try { await rpc('baixar_titulo', { p_titulo_id: t.id, p_data: data, p_conta_id: contaId, p_valor: t.saldo, p_juros: 0, p_desconto: 0, p_forma: forma || null, p_descricao: null }) }
      catch (x: any) { e.push(`${descricaoParcela(t.descricao, t.parcela, t.parcelas)}: ${x.message}`) }
      setFeitos(i + 1)
    }
    setFeitos(null)
    if (e.length) { setErros(e); toast(`${titulos.length - e.length} baixado(s), ${e.length} com erro`, 'erro') }
    else { toast(`${titulos.length} título(s) ${pagar ? 'pagos' : 'recebidos'}`); onFechar(true) }
  }
  return (
    <Modal aberto titulo={`${pagar ? 'Pagar' : 'Receber'} ${titulos.length} título(s)`} onFechar={() => onFechar(erros.length > 0)} largura="max-w-lg">
      <div className="ficha grid grid-cols-2 gap-2">
        <div className="col-span-2 max-h-40 overflow-auto rounded border border-slate-200 text-xs">
          {titulos.map((t) => <div key={t.id} className="flex justify-between gap-2 border-b border-slate-100 px-2 py-0.5"><span className="truncate">{fmtData(t.vencimento)} · {descricaoParcela(t.descricao, t.parcela, t.parcelas)}{t.parceiro && ` · ${t.parceiro}`}</span><b className="tabular-nums">{fmtValor(t.saldo)}</b></div>)}
        </div>
        <div className="col-span-2 text-sm">Total: <b className="tabular-nums">{fmtMoeda(total)}</b> (o saldo de cada título, sem juros nem desconto)</div>
        <Campo label="Data"><input className="input" type="date" value={data} onChange={(e) => setData(e.target.value)} /></Campo>
        <Campo label="Conta">
          <select className="input" value={contaId} onChange={(e) => setContaId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">— escolha —</option>{contas.filter((c) => c.ativa).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </Campo>
        <Campo label="Forma" className="col-span-2"><Opcoes valor={forma} opcoes={FORMAS_PAGAMENTO} vazio="—" onChange={(v) => setForma(v)} /></Campo>
        {erros.length > 0 && <div className="col-span-2 rounded bg-red-50 px-2 py-1 text-[11px] text-red-800">{erros.map((x) => <div key={x}>{x}</div>)}</div>}
        <div className="acoes col-span-2 flex justify-end gap-2">
          <button className="btn-secondary" onClick={() => onFechar(erros.length > 0)}>{erros.length ? 'Fechar' : 'Cancelar'}</button>
          {!erros.length && <button className="btn-primary" disabled={feitos !== null} onClick={executar}>✓ Confirmar {titulos.length} baixa(s)</button>}
        </div>
      </div>
      {feitos !== null && <Progresso titulo={pagar ? 'Pagando os títulos' : 'Recebendo os títulos'} atual={feitos} total={titulos.length} />}
    </Modal>
  )
}
