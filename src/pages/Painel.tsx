// Painel: os números do dia a dia numa chamada só (função painel, 0004) — saldos, mês, a receber/pagar, 12 meses,
// agenda dos próximos 7 dias, para onde vai o dinheiro, inadimplência, orçamento e pendências.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { rpc } from '@/lib/dados'
import { fmtData, fmtMoeda, fmtPct, mesAtual, mesCurto, nomeMes, somarMes } from '@/lib/format'
import { variacao } from '@/lib/relatorios'
import { TIPOS_CONTA, type TipoConta } from '@/lib/types'
import { BotaoAtualizar, Carregando, Chip, Titulo, useToast } from '@/components/ui'
import { COR_ENTRADA, COR_SAIDA, COR_SALDO, GraficoBarras, Indicador, ListaBarras, Secao } from '@/components/Painel'

interface Aberto { vencido: number; qtd_vencido: number; hoje: number; proximos_7: number; proximos_30: number; total: number; qtd: number }
interface DadosPainel {
  periodo: { inicio: string; fim: string; hoje: string }
  contas: { id: number; nome: string; tipo: TipoConta; saldo: number; limite: number | null }[]
  saldo_total: number
  mes: { entradas: number; saidas: number; entradas_anterior: number; saidas_anterior: number }
  serie: { mes: string; entradas: number; saidas: number }[]
  receber: Aberto; pagar: Aberto
  atraso_receber: { ate_30: number; de_31_60: number; de_61_90: number; mais_90: number }
  agenda: { id: number; tipo: 'PAGAR' | 'RECEBER'; vencimento: string; saldo: number; descricao: string; parceiro: string | null }[]
  receitas_por_raiz: { nome: string; total: number }[]
  despesas_por_raiz: { nome: string; total: number }[]
  despesas_por_centro: { nome: string; total: number }[]
  orcamento: { previsto_entradas: number; realizado_entradas: number; previsto_saidas: number; realizado_saidas: number } | null
  pendencias: { lancamentos_pendentes: number; contas_sem_saldo_inicial: number; meses_sem_fechamento: string[]; configuracao_baixa: boolean }
}

const n = (v: number | string | null | undefined) => Number(v ?? 0)

function Variacao({ atual, anterior, inverter }: { atual: number; anterior: number; inverter?: boolean }) {
  const v = variacao(atual, anterior)
  if (v == null) return <span className="text-slate-400">sem base no mês anterior</span>
  const bom = inverter ? v <= 0 : v >= 0
  return <span className={bom ? 'text-emerald-700' : 'text-red-700'}>{v >= 0 ? '▲' : '▼'} {fmtPct(Math.abs(v))} sobre o mês anterior</span>
}

function CartaoAberto({ titulo, a, cor, rota }: { titulo: string; a: Aberto; cor: string; rota: string }) {
  const linha = (rot: string, v: number, destaque?: boolean) => (
    <div className={`flex justify-between gap-2 ${destaque && v > 0 ? 'font-bold text-red-700' : ''}`}><span>{rot}</span><span className="num">{fmtMoeda(v)}</span></div>
  )
  return (
    <div className="card border-l-4 px-3 py-2 text-xs" style={{ borderLeftColor: cor }}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{titulo}</span>
        <Link to={rota} className="text-[11px] font-semibold text-laranja-700 underline">ver</Link>
      </div>
      <div className="mt-0.5 text-xl font-extrabold tabular-nums text-slate-900">{fmtMoeda(a.total)}</div>
      <div className="mb-1 text-[11px] text-slate-500">{a.qtd} título(s) em aberto</div>
      {linha(`Vencido (${a.qtd_vencido})`, n(a.vencido), true)}
      {linha('Vence hoje', n(a.hoje))}
      {linha('Próximos 7 dias', n(a.proximos_7))}
      {linha('Próximos 30 dias', n(a.proximos_30))}
    </div>
  )
}

export default function Painel() {
  const { toast } = useToast()
  const [mes, setMes] = useState(mesAtual())
  const [d, setD] = useState<DadosPainel | null>(null)
  const [erro, setErro] = useState(false)
  const carregar = () => {
    const [y, m] = mes.split('-').map(Number)
    setErro(false)
    rpc<DadosPainel>('painel', { p_ano: y, p_mes: m }).then(setD).catch((e) => { toast(e.message, 'erro'); setErro(true) })
  }
  useEffect(() => { setD(null); carregar() }, [mes])

  if (erro && !d) return <div className="p-6 text-center text-sm text-slate-500">Não foi possível carregar o painel. <button className="underline" onClick={carregar}>Tentar de novo</button></div>
  if (!d) return <Carregando />
  const ent = n(d.mes.entradas), sai = n(d.mes.saidas)
  const p = d.pendencias
  const alertas = [
    p.lancamentos_pendentes > 0 && { texto: `${p.lancamentos_pendentes} lançamento(s) do extrato aguardando classificação`, rota: '/financeiro/conciliacao', acao: 'Conciliar' },
    p.meses_sem_fechamento.length > 0 && { texto: `Mês(es) sem fechamento: ${p.meses_sem_fechamento.join(', ')}`, rota: '/financeiro/fechamento', acao: 'Fechar' },
    p.contas_sem_saldo_inicial > 0 && { texto: `${p.contas_sem_saldo_inicial} conta(s) movimentada(s) sem saldo inicial informado`, rota: '/cadastros/contas', acao: 'Informar' },
    !p.configuracao_baixa && { texto: 'Centros de custo para juros e descontos na baixa de títulos não configurados', rota: '/admin/empresa', acao: 'Configurar' },
  ].filter(Boolean) as { texto: string; rota: string; acao: string }[]
  const atraso = d.atraso_receber
  const orc = d.orcamento

  return (
    <div className="mx-auto max-w-7xl">
      <div className="barra">
        <Titulo>Painel</Titulo>
        <BotaoAtualizar onClick={carregar} />
        <div className="flex items-center gap-1">
          <button className="btn-secondary py-0.5" onClick={() => setMes(somarMes(mes, -1))}>◀</button>
          <input className="input" type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} />
          <button className="btn-secondary py-0.5" onClick={() => setMes(somarMes(mes, 1))}>▶</button>
        </div>
        <span className="text-slate-500">{nomeMes(mes)} · hoje {fmtData(d.periodo.hoje)}</span>
      </div>

      {alertas.length > 0 && (
        <div className="mb-1.5 space-y-1">
          {alertas.map((a) => (
            <div key={a.rota} className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
              <span>⚠️ {a.texto}</span><Link to={a.rota} className="btn-secondary py-0.5">{a.acao}</Link>
            </div>
          ))}
        </div>
      )}

      <div className="mb-1.5 grid grid-cols-2 gap-1.5 lg:grid-cols-4">
        <Indicador rotulo="Saldo em contas" valor={fmtMoeda(d.saldo_total)} apoio={`${d.contas.length} conta(s) ativa(s)`} tom="destaque" icone="💰" />
        <Indicador rotulo="Entradas do mês" valor={fmtMoeda(ent)} apoio={<Variacao atual={ent} anterior={n(d.mes.entradas_anterior)} />} tom="entrada" icone="🔺" />
        <Indicador rotulo="Saídas do mês" valor={fmtMoeda(sai)} apoio={<Variacao atual={sai} anterior={n(d.mes.saidas_anterior)} inverter />} tom="saida" icone="🔻" />
        <Indicador rotulo="Resultado do mês" valor={<span className={ent - sai < 0 ? 'text-red-700' : ''}>{fmtMoeda(ent - sai)}</span>} apoio={ent ? `margem ${fmtPct((ent - sai) / ent)}` : 'entradas − saídas'} tom={ent - sai < 0 ? 'alerta' : 'neutro'} icone="⚖️" />
      </div>

      <div className="mb-1.5 grid grid-cols-1 gap-1.5 md:grid-cols-2">
        <CartaoAberto titulo="A receber" a={d.receber} cor={COR_ENTRADA} rota="/financeiro/receber" />
        <CartaoAberto titulo="A pagar" a={d.pagar} cor={COR_SAIDA} rota="/financeiro/pagar" />
      </div>

      <div className="grid grid-cols-1 gap-1.5 lg:grid-cols-3">
        <Secao titulo="Últimos 12 meses" className="lg:col-span-2" abertoInicial>
          <GraficoBarras periodos={d.serie.map((s) => mesCurto(s.mes))} fmt={fmtMoeda}
            series={[{ nome: 'Entradas', cor: COR_ENTRADA, valores: d.serie.map((s) => n(s.entradas)) }, { nome: 'Saídas', cor: COR_SAIDA, valores: d.serie.map((s) => n(s.saidas)) }]}
            linha={{ nome: 'Resultado', cor: COR_SALDO, valores: d.serie.map((s) => n(s.entradas) - n(s.saidas)) }} />
        </Secao>

        <Secao titulo={`Agenda · próximos 7 dias (${d.agenda.length})`} abertoInicial>
          {d.agenda.length === 0 ? <div className="py-4 text-center text-xs text-slate-400">Nada vencendo nos próximos 7 dias.</div> : (
            <ul className="divide-y divide-slate-100 text-xs">
              {d.agenda.map((a) => {
                const vencido = a.vencimento < d.periodo.hoje
                return (
                  <li key={a.id}>
                    <Link to={`/financeiro/${a.tipo === 'PAGAR' ? 'pagar' : 'receber'}?abrir=${a.id}`} className="flex items-center gap-2 py-1 hover:bg-slate-50">
                      <span className={`w-12 shrink-0 tabular-nums ${vencido ? 'font-bold text-red-700' : 'text-slate-600'}`}>{fmtData(a.vencimento).slice(0, 5)}</span>
                      <span className="min-w-0 flex-1 truncate">{a.descricao}{a.parceiro && <span className="text-slate-400"> · {a.parceiro}</span>}</span>
                      <span className={`num font-semibold ${a.tipo === 'PAGAR' ? 'text-red-700' : 'text-emerald-700'}`}>{a.tipo === 'PAGAR' ? '−' : '+'}{fmtMoeda(a.saldo)}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Secao>

        <Secao titulo={`Despesas do mês por grupo`}>
          <ListaBarras cor={COR_SAIDA} vazio="Nenhuma saída no mês." itens={d.despesas_por_raiz.map((x) => ({ chave: x.nome, rotulo: x.nome, valor: n(x.total), texto: fmtMoeda(x.total), detalhe: sai ? fmtPct(n(x.total) / sai) : undefined }))} />
        </Secao>
        <Secao titulo="Receitas do mês por grupo">
          <ListaBarras cor={COR_ENTRADA} vazio="Nenhuma entrada no mês." itens={d.receitas_por_raiz.map((x) => ({ chave: x.nome, rotulo: x.nome, valor: n(x.total), texto: fmtMoeda(x.total), detalhe: ent ? fmtPct(n(x.total) / ent) : undefined }))} />
        </Secao>
        <Secao titulo="Despesas do mês por centro de custo">
          <ListaBarras cor={COR_SALDO} vazio="Nenhuma saída no mês." itens={d.despesas_por_centro.map((x) => ({ chave: x.nome, rotulo: x.nome, valor: n(x.total), texto: fmtMoeda(x.total) }))} />
        </Secao>

        <Secao titulo="Saldos por conta">
          <ul className="divide-y divide-slate-100 text-xs">
            {d.contas.map((c) => (
              <li key={c.id} className="flex items-center gap-2 py-1">
                <Link to={`/relatorios/extrato?conta=${c.id}`} className="min-w-0 flex-1 truncate font-semibold text-grafite-900 hover:underline">{c.nome}</Link>
                <span className="text-[10px] text-slate-400">{TIPOS_CONTA[c.tipo]}</span>
                <span className={`num font-semibold ${n(c.saldo) < 0 ? 'text-red-700' : ''}`}>{fmtMoeda(c.saldo)}</span>
              </li>
            ))}
            {d.contas.length === 0 && <li className="py-4 text-center text-slate-400">Nenhuma conta ativa.</li>}
          </ul>
        </Secao>
        <Secao titulo="Inadimplência · a receber vencido">
          <ListaBarras cor="#dc2626" vazio="Nada vencido."
            itens={[['Até 30 dias', atraso.ate_30], ['31 a 60 dias', atraso.de_31_60], ['61 a 90 dias', atraso.de_61_90], ['Mais de 90 dias', atraso.mais_90]]
              .filter(([, v]) => n(v as number) > 0).map(([r, v]) => ({ chave: r as string, rotulo: r as string, valor: n(v as number), texto: fmtMoeda(v as number) }))} />
        </Secao>
        <Secao titulo="Orçamento do mês">
          {!orc ? (
            <div className="py-3 text-center text-xs text-slate-400">Sem orçamento para {nomeMes(mes)}. <Link to="/financeiro/orcamento" className="underline">Montar o orçamento</Link></div>
          ) : (
            <div className="space-y-2 text-xs">
              {([['Entradas', n(orc.previsto_entradas), n(orc.realizado_entradas), false], ['Saídas', n(orc.previsto_saidas), n(orc.realizado_saidas), true]] as const).map(([r, prev, real, saida]) => {
                const pct = prev ? real / prev : 0
                const ruim = saida ? pct > 1 : pct < 1
                return (
                  <div key={r}>
                    <div className="flex justify-between"><b>{r}</b><span className="num">{fmtMoeda(real)} de {fmtMoeda(prev)}</span></div>
                    <div className="mt-0.5 h-2.5 overflow-hidden rounded bg-slate-100"><div className="h-full rounded" style={{ width: `${Math.min(100, pct * 100)}%`, background: ruim ? '#dc2626' : COR_ENTRADA }} /></div>
                    <div className={`text-right text-[11px] ${ruim ? 'text-red-700' : 'text-slate-500'}`}>{fmtPct(pct)} do previsto</div>
                  </div>
                )
              })}
              <Link to="/financeiro/orcamento" className="text-[11px] text-laranja-700 underline">ver previsto × realizado</Link>
            </div>
          )}
        </Secao>
      </div>
      <div className="mt-1.5 text-center text-[10px] text-slate-400">Valores confirmados pela data do lançamento (regime de caixa). <Chip cor="cinza">A receber e a pagar: saldo dos títulos em aberto</Chip></div>
    </div>
  )
}
