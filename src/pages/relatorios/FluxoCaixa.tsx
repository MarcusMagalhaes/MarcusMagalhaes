// Fluxo de caixa (função fluxo_caixa, 0004): realizado (lançamentos confirmados) + previsto (saldo dos títulos em
// aberto pelo vencimento), por dia, semana ou mês, com o saldo acumulado e o aviso de quando ele fica negativo.
import { useEffect, useMemo, useState } from 'react'
import { listarContas, rpc } from '@/lib/dados'
import { fmtData, fmtMoeda, fmtValor, hojeISO, limitesDoMes, mesAtual, mesCurto, somarDias, somarMes } from '@/lib/format'
import { acumularFluxo, primeiroNegativo, type PeriodoFluxo } from '@/lib/relatorios'
import { baixarCsv } from '@/lib/csv'
import { cabecalhoImpressao, escHtml, imprimirHtml } from '@/lib/imprimir'
import { nomeDaEmpresa, useDadosEmpresa } from '@/lib/empresa'
import type { ContaFinanceira } from '@/lib/types'
import { BotaoAtualizar, Campo, Carregando, Titulo, useToast, Vazio } from '@/components/ui'
import { COR_ENTRADA, COR_SAIDA, COR_SALDO, GraficoBarras } from '@/components/Painel'

type Agrupar = 'DIA' | 'SEMANA' | 'MES'
const AGRUPAR: Record<Agrupar, string> = { DIA: 'Dia', SEMANA: 'Semana', MES: 'Mês' }
interface Resposta { de: string; ate: string; agrupar: Agrupar; hoje: string; saldo_inicial: number; previsto_antes: number; periodos: PeriodoFluxo[] }

/** rótulo do período: dia 'DD/MM', semana 'DD/MM a DD/MM', mês 'Out/26' */
function rotuloPeriodo(inicio: string, ag: Agrupar, ate: string) {
  if (ag === 'MES') return mesCurto(inicio.slice(0, 7))
  if (ag === 'DIA') return fmtData(inicio).slice(0, 5)
  const fim = somarDias(inicio, 6)
  return `${fmtData(inicio).slice(0, 5)} a ${fmtData(fim < ate ? fim : ate).slice(0, 5)}`
}

export default function FluxoCaixa() {
  const { toast } = useToast()
  const empresa = useDadosEmpresa()
  const [de, setDe] = useState(limitesDoMes(mesAtual()).de)
  const [ate, setAte] = useState(limitesDoMes(somarMes(mesAtual(), 2)).ate)
  const [agrupar, setAgrupar] = useState<Agrupar>('SEMANA')
  const [contaId, setContaId] = useState<number | ''>('')
  const [previstos, setPrevistos] = useState(true)
  const [contas, setContas] = useState<ContaFinanceira[]>([])
  const [r, setR] = useState<Resposta | null>(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => { listarContas(false).then(setContas).catch(() => {}) }, [])
  const carregar = () => {
    if (!de || !ate || ate < de) { toast('Período inválido', 'erro'); return }
    setCarregando(true)
    rpc<Resposta>('fluxo_caixa', { p_de: de, p_ate: ate, p_agrupar: agrupar, p_conta_id: contaId || null })
      .then(setR).catch((e) => toast(e.message, 'erro')).finally(() => setCarregando(false))
  }
  useEffect(() => { carregar() }, [de, ate, agrupar, contaId])

  const linhas = useMemo(() => (r ? acumularFluxo(r.saldo_inicial, r.previsto_antes, r.periodos, previstos) : []), [r, previstos])
  const negativo = primeiroNegativo(linhas)
  const tot = linhas.reduce((t, l) => ({ e: t.e + l.entradas, s: t.s + l.saidas, ep: t.ep + l.entradas_previstas, sp: t.sp + l.saidas_previstas }), { e: 0, s: 0, ep: 0, sp: 0 })
  const inicial = r ? Number(r.saldo_inicial) + (previstos ? Number(r.previsto_antes) : 0) : 0
  const nomeConta = contaId ? contas.find((c) => c.id === contaId)?.nome : 'Todas as contas'
  const rot = (l: { inicio: string }) => rotuloPeriodo(l.inicio, r?.agrupar ?? agrupar, ate)
  // período que contém hoje (destacado na tabela)
  const atual = r ? linhas.filter((l) => l.inicio <= r.hoje).pop()?.inicio ?? null : null
  const titulo = `Fluxo de caixa de ${fmtData(de)} a ${fmtData(ate)}`

  function imprimir() {
    const tr = linhas.map((l) => `<tr><td>${escHtml(rot(l))}</td><td class="num">${fmtValor(l.entradas)}</td><td class="num">${fmtValor(l.saidas)}</td>${previstos ? `<td class="num">${fmtValor(l.entradas_previstas)}</td><td class="num">${fmtValor(l.saidas_previstas)}</td>` : ''}<td class="num">${fmtValor(l.saldo_periodo)}</td><td class="num" style="${l.saldo_acumulado < 0 ? 'color:#b91c1c;font-weight:700' : ''}">${fmtValor(l.saldo_acumulado)}</td></tr>`).join('')
    imprimirHtml(titulo, `${cabecalhoImpressao(nomeDaEmpresa(empresa), titulo, `${nomeConta} · por ${AGRUPAR[agrupar].toLowerCase()} · ${previstos ? 'realizado + previsto' : 'só realizado'} · saldo inicial ${fmtMoeda(inicial)}`)}
      <table class="tabela"><thead><tr><th>Período</th><th class="num">Entradas</th><th class="num">Saídas</th>${previstos ? '<th class="num">Entradas previstas</th><th class="num">Saídas previstas</th>' : ''}<th class="num">Saldo do período</th><th class="num">Saldo acumulado</th></tr></thead>
      <tbody class="zebra">${tr}</tbody><tfoot><tr><td>Total</td><td class="num">${fmtValor(tot.e)}</td><td class="num">${fmtValor(tot.s)}</td>${previstos ? `<td class="num">${fmtValor(tot.ep)}</td><td class="num">${fmtValor(tot.sp)}</td>` : ''}<td class="num">${fmtValor(tot.e - tot.s + tot.ep - tot.sp)}</td><td class="num">${fmtValor(linhas[linhas.length - 1]?.saldo_acumulado ?? inicial)}</td></tr></tfoot></table>`, 'landscape')
  }
  function csv() {
    baixarCsv(`fluxo-de-caixa-${de}-a-${ate}`, ['Período', 'Início', 'Entradas', 'Saídas', 'Entradas previstas', 'Saídas previstas', 'Saldo do período', 'Saldo acumulado'],
      linhas.map((l) => [rot(l), fmtData(l.inicio), l.entradas, l.saidas, l.entradas_previstas, l.saidas_previstas, l.saldo_periodo, l.saldo_acumulado]))
  }

  return (
    <div className="flex h-full flex-col">
      <div className="barra">
        <Titulo>Fluxo de caixa</Titulo>
        <BotaoAtualizar onClick={carregar} ocupado={carregando} />
        <Campo label="De"><input className="input" type="date" value={de} onChange={(e) => e.target.value && setDe(e.target.value)} /></Campo>
        <Campo label="Até"><input className="input" type="date" value={ate} onChange={(e) => e.target.value && setAte(e.target.value)} /></Campo>
        <Campo label="Agrupar">
          <select className="input" value={agrupar} onChange={(e) => setAgrupar(e.target.value as Agrupar)}>{Object.entries(AGRUPAR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </Campo>
        <Campo label="Conta">
          <select className="input" value={contaId} onChange={(e) => setContaId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Todas</option>{contas.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.ativa ? '' : ' (inativa)'}</option>)}
          </select>
        </Campo>
        <label className="flex items-center gap-1"><input type="checkbox" checked={previstos} onChange={(e) => setPrevistos(e.target.checked)} /> incluir previstos</label>
        <div className="ml-auto flex gap-1.5">
          <button className="btn-secondary" onClick={csv} disabled={!linhas.length}>⬇ CSV</button>
          <button className="btn-secondary" onClick={imprimir} disabled={!linhas.length}>🖨️</button>
        </div>
      </div>
      {!r ? <Carregando /> : (
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="mb-1.5 grid grid-cols-2 gap-1.5 text-xs lg:grid-cols-4">
            <div className="card px-3 py-1.5 border-l-4 border-l-grafite-700"><span className="text-slate-500">Saldo inicial </span><b className="num">{fmtMoeda(inicial)}</b></div>
            <div className="card px-3 py-1.5 border-l-4 border-l-emerald-600"><span className="text-slate-500">Entradas{previstos ? ' (+ previstas)' : ''} </span><b className="num">{fmtMoeda(tot.e + tot.ep)}</b></div>
            <div className="card px-3 py-1.5 border-l-4 border-l-red-600"><span className="text-slate-500">Saídas{previstos ? ' (+ previstas)' : ''} </span><b className="num">{fmtMoeda(tot.s + tot.sp)}</b></div>
            <div className="card px-3 py-1.5 border-l-4 border-l-laranja-500"><span className="text-slate-500">Saldo final </span><b className={`num ${(linhas[linhas.length - 1]?.saldo_acumulado ?? inicial) < 0 ? 'text-red-700' : ''}`}>{fmtMoeda(linhas[linhas.length - 1]?.saldo_acumulado ?? inicial)}</b></div>
          </div>
          {negativo && (
            <div className="mb-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-800">
              ⚠️ O saldo projetado fica negativo a partir de {rot(negativo)} ({fmtMoeda(negativo.saldo_acumulado)}). Antecipe recebimentos, renegocie pagamentos ou programe um aporte.
            </div>
          )}
          <div className="card mb-1.5 p-3">
            <GraficoBarras periodos={linhas.map(rot)} fmt={fmtMoeda}
              series={[
                { nome: 'Entradas', cor: COR_ENTRADA, valores: linhas.map((l) => l.entradas) },
                { nome: 'Saídas', cor: COR_SAIDA, valores: linhas.map((l) => l.saidas) },
                ...(previstos ? [{ nome: 'Entradas previstas', cor: COR_ENTRADA, valores: linhas.map((l) => l.entradas_previstas), tracejada: true },
                  { nome: 'Saídas previstas', cor: COR_SAIDA, valores: linhas.map((l) => l.saidas_previstas), tracejada: true }] : []),
              ]}
              linha={{ nome: 'Saldo acumulado', cor: COR_SALDO, valores: linhas.map((l) => l.saldo_acumulado) }} />
          </div>
          <div className="card overflow-auto">
            {linhas.length === 0 ? <Vazio texto="Nenhum período." /> : (
              <table className="tabela">
                <thead><tr><th>Período</th><th className="num">Entradas</th><th className="num">Saídas</th>{previstos && <><th className="num">Entradas previstas</th><th className="num">Saídas previstas</th></>}<th className="num">Saldo do período</th><th className="num">Saldo acumulado</th></tr></thead>
                <tbody>
                  {linhas.map((l) => (
                    <tr key={l.inicio} className={l.inicio === atual ? 'font-semibold' : ''} title={l.inicio === atual ? 'período de hoje' : undefined}>
                      <td className="whitespace-nowrap">{rot(l)}</td>
                      <td className="num text-emerald-700">{l.entradas ? fmtValor(l.entradas) : ''}</td>
                      <td className="num text-red-700">{l.saidas ? fmtValor(l.saidas) : ''}</td>
                      {previstos && <><td className="num text-emerald-600/80 italic">{l.entradas_previstas ? fmtValor(l.entradas_previstas) : ''}</td><td className="num text-red-600/80 italic">{l.saidas_previstas ? fmtValor(l.saidas_previstas) : ''}</td></>}
                      <td className={`num ${l.saldo_periodo < 0 ? 'text-red-700' : ''}`}>{fmtValor(l.saldo_periodo)}</td>
                      <td className={`num font-bold ${l.saldo_acumulado < 0 ? 'bg-red-50 text-red-700' : ''}`}>{fmtValor(l.saldo_acumulado)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td>Total</td><td className="num">{fmtValor(tot.e)}</td><td className="num">{fmtValor(tot.s)}</td>{previstos && <><td className="num">{fmtValor(tot.ep)}</td><td className="num">{fmtValor(tot.sp)}</td></>}<td className="num">{fmtValor(tot.e - tot.s + tot.ep - tot.sp)}</td><td className="num">{fmtValor(linhas[linhas.length - 1]?.saldo_acumulado ?? inicial)}</td></tr></tfoot>
              </table>
            )}
          </div>
          <p className="mt-1.5 text-[11px] text-slate-500">
            Realizado = lançamentos confirmados; previsto = saldo dos títulos a pagar e a receber em aberto, pelo vencimento. Títulos vencidos entram como previstos para hoje ({fmtData(hojeISO())}).
            {contaId ? ' Com uma conta escolhida, as transferências contam como entrada/saída dela e só entram os títulos com essa conta prevista.' : ' Transferências entre contas não mudam o total e ficam de fora.'}
          </p>
        </div>
      )}
    </div>
  )
}
