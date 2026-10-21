// Relatório mensal (balancete do mês, função balancete_mes): saldo inicial, entradas e saídas por grupo e conta do
// plano, saldo final por conta e o resumo das contas a pagar/receber que venceram no mês.
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { rpc, todas } from '@/lib/dados'
import { fmtMoeda, fmtValor, limitesDoMes, mesAtual, nomeMes, somarMes, somar } from '@/lib/format'
import { fmtCodigoCurto } from '@/lib/planoContas'
import { baixarCsv } from '@/lib/csv'
import { cabecalhoImpressao, escHtml, imprimirHtml } from '@/lib/imprimir'
import { nomeDaEmpresa, useDadosEmpresa } from '@/lib/empresa'
import { TIPOS_CONTA, type Balancete, type SituacaoTitulo, type TipoMovimento, type TipoTitulo } from '@/lib/types'
import { BotaoAtualizar, Carregando, Titulo, useToast } from '@/components/ui'
import { Indicador, Secao } from '@/components/Painel'

type LinhaTitulo = { tipo: TipoTitulo; situacao: SituacaoTitulo; valor: number; valor_pago: number; saldo: number; vencido: boolean }
type Plano = Balancete['planos'][number]
interface ResumoTitulos { qtd: number; valor: number; quitado: number; qtdQuitado: number; aberto: number; qtdAberto: number; vencido: number; qtdVencido: number }

/** planos de um tipo agrupados pela conta do 1º nível */
function porRaiz(planos: Plano[], tipo: TipoMovimento) {
  const m = new Map<number, { raiz: string; total: number; itens: Plano[] }>()
  for (const p of planos.filter((x) => x.tipo === tipo)) {
    const g = m.get(p.raiz_codigo) ?? { raiz: p.raiz, total: 0, itens: [] }
    g.total = somar([g.total, p.total]); g.itens.push(p)
    m.set(p.raiz_codigo, g)
  }
  return [...m.entries()].sort(([a], [b]) => a - b).map(([, g]) => g)
}
function resumir(l: LinhaTitulo[]): ResumoTitulos {
  const r: ResumoTitulos = { qtd: 0, valor: 0, quitado: 0, qtdQuitado: 0, aberto: 0, qtdAberto: 0, vencido: 0, qtdVencido: 0 }
  for (const t of l) {
    if (t.situacao === 'CANCELADO') continue
    r.qtd++; r.valor = somar([r.valor, t.valor])
    if (t.situacao === 'PAGO') { r.qtdQuitado++; r.quitado = somar([r.quitado, t.valor_pago]) }
    else { r.qtdAberto++; r.aberto = somar([r.aberto, t.saldo]); if (t.vencido) { r.qtdVencido++; r.vencido = somar([r.vencido, t.saldo]) } }
  }
  return r
}

export default function RelatorioMensal() {
  const { toast } = useToast()
  const empresa = useDadosEmpresa()
  const [mes, setMes] = useState(somarMes(mesAtual(), -1))
  const [b, setB] = useState<Balancete | null>(null)
  const [titulos, setTitulos] = useState<LinhaTitulo[]>([])
  const carregar = async () => {
    setB(null)
    const { de, ate } = limitesDoMes(mes)
    try {
      const [bal, tit] = await Promise.all([
        rpc<Balancete>('balancete_mes', { p_mes: de }),
        todas<LinhaTitulo>((a, z) => supabase.from('v_titulo').select('id, tipo, situacao, valor, valor_pago, saldo, vencido').gte('vencimento', de).lte('vencimento', ate).order('id').range(a, z)),
      ])
      setTitulos(tit); setB(bal)
    } catch (e: any) { toast(e.message, 'erro') }
  }
  useEffect(() => { carregar() }, [mes])

  const entradas = useMemo(() => (b ? porRaiz(b.planos, 'ENTRADA') : []), [b])
  const saidas = useMemo(() => (b ? porRaiz(b.planos, 'SAIDA') : []), [b])
  const pagar = useMemo(() => resumir(titulos.filter((t) => t.tipo === 'PAGAR')), [titulos])
  const receber = useMemo(() => resumir(titulos.filter((t) => t.tipo === 'RECEBER')), [titulos])
  const titulo = `Relatório mensal · ${nomeMes(mes)}`

  function imprimir() {
    if (!b) return
    const bloco = (rot: string, grupos: ReturnType<typeof porRaiz>, total: number) => `<h2 style="font-size:11pt;margin:10px 0 2px;color:#34404c">${rot}</h2>
      <table class="tabela"><tbody>${grupos.map((g) => `<tr><td style="font-weight:700">${escHtml(g.raiz)}</td><td class="num" style="font-weight:700">${fmtValor(g.total)}</td></tr>${g.itens.map((p) => `<tr><td style="padding-left:16px">${fmtCodigoCurto(p.codigo)} ${escHtml(p.nome)} <span style="color:#94a3b8">(${p.qtd})</span></td><td class="num">${fmtValor(p.total)}</td></tr>`).join('')}`).join('')}
      <tr><td style="font-weight:800;border-top:2px solid #94a3b8">Total</td><td class="num" style="font-weight:800;border-top:2px solid #94a3b8">${fmtValor(total)}</td></tr></tbody></table>`
    const contas = `<h2 style="font-size:11pt;margin:10px 0 2px;color:#34404c">Saldos por conta</h2><table class="tabela"><thead><tr><th>Conta</th><th class="num">Saldo inicial</th><th class="num">Saldo final</th></tr></thead><tbody>${b.contas.map((c) => `<tr><td>${escHtml(c.nome)}</td><td class="num">${fmtValor(c.inicial)}</td><td class="num">${fmtValor(c.final)}</td></tr>`).join('')}</tbody></table>`
    imprimirHtml(titulo, `${cabecalhoImpressao(nomeDaEmpresa(empresa), titulo, `Saldo inicial ${fmtMoeda(b.saldo_inicial)} · Entradas ${fmtMoeda(b.entradas)} · Saídas ${fmtMoeda(b.saidas)} · Saldo final ${fmtMoeda(b.saldo_final)}`)}
      ${b.pendentes ? `<p style="color:#b45309;font-weight:700">Atenção: ${b.pendentes} lançamento(s) pendente(s) de classificação não entram neste relatório.</p>` : ''}
      ${bloco('Entradas', entradas, Number(b.entradas))}${bloco('Saídas', saidas, Number(b.saidas))}${contas}
      <h2 style="font-size:11pt;margin:10px 0 2px;color:#34404c">Contas com vencimento no mês</h2><table class="tabela"><thead><tr><th></th><th class="num">Títulos</th><th class="num">Valor</th><th class="num">Quitado</th><th class="num">Em aberto</th><th class="num">Vencido</th></tr></thead><tbody>
      ${([['A receber', receber], ['A pagar', pagar]] as const).map(([r, x]) => `<tr><td>${r}</td><td class="num">${x.qtd}</td><td class="num">${fmtValor(x.valor)}</td><td class="num">${fmtValor(x.quitado)}</td><td class="num">${fmtValor(x.aberto)}</td><td class="num">${fmtValor(x.vencido)}</td></tr>`).join('')}</tbody></table>`)
  }
  function csv() {
    if (!b) return
    const linhas = [...entradas.flatMap((g) => g.itens.map((p) => ['Entrada', g.raiz, fmtCodigoCurto(p.codigo), p.nome, p.qtd, Number(p.total)])),
      ...saidas.flatMap((g) => g.itens.map((p) => ['Saída', g.raiz, fmtCodigoCurto(p.codigo), p.nome, p.qtd, Number(p.total)]))]
    baixarCsv(`relatorio-mensal-${mes}`, ['Tipo', 'Grupo', 'Código', 'Conta do plano', 'Lançamentos', 'Total'], linhas)
  }

  const Grupos = ({ grupos, cor }: { grupos: ReturnType<typeof porRaiz>; cor: string }) => grupos.length === 0 ? <div className="py-3 text-center text-xs text-slate-400">Nenhum lançamento.</div> : (
    <table className="tabela">
      <tbody>
        {grupos.map((g) => (
          <Fragment key={g.raiz}>
            <tr><td className="font-bold">{g.raiz}</td><td className={`num font-bold ${cor}`}>{fmtValor(g.total)}</td></tr>
            {g.itens.map((p) => <tr key={p.plano_conta_id}><td className="pl-5 text-slate-600"><span className="mr-1 font-mono text-[10px] text-slate-400">{fmtCodigoCurto(p.codigo)}</span>{p.nome} <span className="text-slate-400">({p.qtd})</span></td><td className="num">{fmtValor(p.total)}</td></tr>)}
          </Fragment>
        ))}
      </tbody>
    </table>
  )
  const CartaoTitulos = ({ rot, x, rota }: { rot: string; x: ResumoTitulos; rota: string }) => (
    <div className="text-xs">
      <div className="mb-1 flex items-center justify-between"><b>{rot}</b><Link to={rota} className="text-[11px] text-laranja-700 underline">ver</Link></div>
      <div className="flex justify-between"><span>{x.qtd} título(s) vencendo no mês</span><span className="num">{fmtMoeda(x.valor)}</span></div>
      <div className="flex justify-between text-emerald-700"><span>Quitados ({x.qtdQuitado})</span><span className="num">{fmtMoeda(x.quitado)}</span></div>
      <div className="flex justify-between"><span>Em aberto ({x.qtdAberto})</span><span className="num">{fmtMoeda(x.aberto)}</span></div>
      <div className={`flex justify-between ${x.vencido ? 'font-bold text-red-700' : ''}`}><span>Vencidos ({x.qtdVencido})</span><span className="num">{fmtMoeda(x.vencido)}</span></div>
    </div>
  )

  return (
    <div className="mx-auto max-w-6xl">
      <div className="barra">
        <Titulo>Relatório mensal</Titulo>
        <BotaoAtualizar onClick={carregar} />
        <div className="flex items-center gap-1">
          <button className="btn-secondary py-0.5" onClick={() => setMes(somarMes(mes, -1))}>◀</button>
          <input className="input" type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} />
          <button className="btn-secondary py-0.5" onClick={() => setMes(somarMes(mes, 1))}>▶</button>
        </div>
        <span className="text-slate-500">{nomeMes(mes)}</span>
        <div className="ml-auto flex gap-1.5">
          <button className="btn-secondary" onClick={csv} disabled={!b}>⬇ CSV</button>
          <button className="btn-secondary" onClick={imprimir} disabled={!b}>🖨️</button>
        </div>
      </div>
      {!b ? <Carregando /> : (
        <>
          {b.pendentes > 0 && (
            <div className="mb-1.5 flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
              <span>⚠️ {b.pendentes} lançamento(s) do extrato neste mês aguardam classificação e não entram no relatório.</span>
              <Link to="/financeiro/conciliacao" className="btn-secondary py-0.5">Conciliar</Link>
            </div>
          )}
          <div className="mb-1.5 grid grid-cols-2 gap-1.5 lg:grid-cols-4">
            <Indicador rotulo="Saldo inicial" valor={fmtMoeda(b.saldo_inicial)} />
            <Indicador rotulo="Entradas" valor={fmtMoeda(b.entradas)} tom="entrada" />
            <Indicador rotulo="Saídas" valor={fmtMoeda(b.saidas)} tom="saida" apoio={`resultado ${fmtMoeda(Number(b.entradas) - Number(b.saidas))}`} />
            <Indicador rotulo="Saldo final" valor={<span className={Number(b.saldo_final) < 0 ? 'text-red-700' : ''}>{fmtMoeda(b.saldo_final)}</span>} tom="destaque" apoio="soma das contas (inclui transferências)" />
          </div>
          <div className="grid grid-cols-1 gap-1.5 lg:grid-cols-2">
            <Secao titulo={`Entradas · ${fmtMoeda(b.entradas)}`} abertoInicial><Grupos grupos={entradas} cor="text-emerald-700" /></Secao>
            <Secao titulo={`Saídas · ${fmtMoeda(b.saidas)}`} abertoInicial><Grupos grupos={saidas} cor="text-red-700" /></Secao>
            <Secao titulo="Saldos por conta">
              <table className="tabela">
                <thead><tr><th>Conta</th><th>Tipo</th><th className="num">Inicial</th><th className="num">Final</th><th className="num">Variação</th></tr></thead>
                <tbody>{b.contas.map((c) => (
                  <tr key={c.id}><td><Link className="font-semibold text-grafite-900 hover:underline" to={`/relatorios/extrato?conta=${c.id}`}>{c.nome}</Link></td><td>{TIPOS_CONTA[c.tipo]}</td>
                    <td className="num">{fmtValor(c.inicial)}</td><td className={`num font-semibold ${Number(c.final) < 0 ? 'text-red-700' : ''}`}>{fmtValor(c.final)}</td><td className="num">{fmtValor(Number(c.final) - Number(c.inicial))}</td></tr>
                ))}</tbody>
                <tfoot><tr><td colSpan={2}>Total</td><td className="num">{fmtValor(b.saldo_inicial)}</td><td className="num">{fmtValor(b.saldo_final)}</td><td className="num">{fmtValor(Number(b.saldo_final) - Number(b.saldo_inicial))}</td></tr></tfoot>
              </table>
            </Secao>
            <Secao titulo="Contas com vencimento no mês">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <CartaoTitulos rot="A receber" x={receber} rota="/financeiro/receber" />
                <CartaoTitulos rot="A pagar" x={pagar} rota="/financeiro/pagar" />
              </div>
            </Secao>
          </div>
        </>
      )}
    </div>
  )
}
