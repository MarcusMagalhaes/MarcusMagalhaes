// DRE gerencial (função dre, 0004): totais por centro de custo e mês, montados pela estrutura da DRE (lib/planoContas)
// em lib/relatorios.ts. Competência (títulos pela competência + lançamentos avulsos) ou caixa (lançamentos pela data).
import { useEffect, useMemo, useState } from 'react'
import { listarPlano, rpc } from '@/lib/dados'
import { fmtData, fmtPct, fmtValor, hojeISO, mesCurto } from '@/lib/format'
import { ATALHOS_PERIODO, mesesDoPeriodo, montarDre, periodoDoAtalho, receitaLiquida, type AtalhoPeriodo, type LinhaDreBanco, type LinhaDreMontada } from '@/lib/relatorios'
import { fmtCodigoCurto } from '@/lib/planoContas'
import { baixarCsv } from '@/lib/csv'
import { cabecalhoImpressao, escHtml, imprimirHtml } from '@/lib/imprimir'
import { nomeDaEmpresa, useDadosEmpresa } from '@/lib/empresa'
import type { GrupoPlano, PlanoConta } from '@/lib/types'
import { BotaoAtualizar, Campo, Carregando, Titulo, useToast } from '@/components/ui'

type Regime = 'COMPETENCIA' | 'CAIXA'
const REGIMES: Record<Regime, string> = { COMPETENCIA: 'Competência', CAIXA: 'Caixa' }

export default function Dre() {
  const { toast } = useToast()
  const empresa = useDadosEmpresa()
  const [atalho, setAtalho] = useState<AtalhoPeriodo>('ANO')
  const [de, setDe] = useState(periodoDoAtalho('ANO', hojeISO()).de)
  const [ate, setAte] = useState(periodoDoAtalho('ANO', hojeISO()).ate)
  const [regime, setRegime] = useState<Regime>('COMPETENCIA')
  const [mensal, setMensal] = useState(false)
  const [planos, setPlanos] = useState<PlanoConta[] | null>(null)
  const [linhasBanco, setLinhasBanco] = useState<LinhaDreBanco[] | null>(null)
  const [abertos, setAbertos] = useState<Set<string>>(new Set())

  useEffect(() => {
    listarPlano(false).then(setPlanos).catch((e) => toast(e.message, 'erro'))
  }, [])
  const carregar = () => {
    if (!de || !ate || ate < de) { toast('Período inválido', 'erro'); return }
    setLinhasBanco(null)
    rpc<LinhaDreBanco[]>('dre', { p_de: de, p_ate: ate, p_regime: regime })
      .then(setLinhasBanco).catch((e) => { toast(e.message, 'erro'); setLinhasBanco([]) })
  }
  useEffect(() => { carregar() }, [de, ate, regime])
  function escolherAtalho(a: AtalhoPeriodo) {
    setAtalho(a)
    if (a !== 'PERSONALIZADO') { const p = periodoDoAtalho(a, hojeISO()); setDe(p.de); setAte(p.ate) }
  }

  const meses = useMemo(() => mesesDoPeriodo(de, ate), [de, ate])
  const dre = useMemo(() => (planos && linhasBanco ? montarDre(linhasBanco, planos, meses) : null), [planos, linhasBanco, meses])
  const alternar = (g: string) => setAbertos((a) => { const s = new Set(a); if (s.has(g)) s.delete(g); else s.add(g); return s })
  const gruposComContas = useMemo(() => new Set((dre ?? []).filter((l) => l.tipo === 'conta').map((l) => l.grupo as string)), [dre])
  const visiveis = (dre ?? []).filter((l) => l.tipo !== 'conta' || abertos.has(l.grupo as string))
  const rl = dre ? receitaLiquida(dre) : 0
  const colunasMes = mensal ? meses : []
  const titulo = `DRE gerencial · ${fmtData(de)} a ${fmtData(ate)}`
  const detalhe = `Regime de ${REGIMES[regime].toLowerCase()}`
  const pct = (l: LinhaDreMontada) => (rl ? fmtPct(l.total / rl) : '—')
  const rotuloConta = (l: LinhaDreMontada) => `${l.conta ? fmtCodigoCurto(l.conta.codigo) + ' ' : ''}${l.rotulo}`
  const destaque = (l: LinhaDreMontada) => l.tipo === 'resultado' || l.tipo === 'caixa'

  function imprimir() {
    if (!dre) return
    const tr = dre.filter((l) => l.tipo !== 'conta' || abertos.has(l.grupo as string)).map((l) => {
      const estilo = destaque(l) ? 'font-weight:700;background:#eceff2' : l.tipo === 'conta' ? `color:#475569;padding-left:${8 + (l.nivel ?? 1) * 8}px` : 'font-weight:600'
      return `<tr><td style="${estilo}">${escHtml(l.tipo === 'conta' ? rotuloConta(l) : l.rotulo)}</td>${colunasMes.map((m) => `<td class="num" style="${estilo}">${fmtValor(l.porMes[m] ?? 0)}</td>`).join('')}<td class="num" style="${estilo}">${fmtValor(l.total)}</td><td class="num" style="${estilo}">${pct(l)}</td></tr>`
    }).join('')
    imprimirHtml(titulo, `${cabecalhoImpressao(nomeDaEmpresa(empresa), titulo, detalhe)}
      <table class="tabela"><thead><tr><th>Descrição</th>${colunasMes.map((m) => `<th class="num">${mesCurto(m)}</th>`).join('')}<th class="num">Total</th><th class="num">% RL</th></tr></thead><tbody>${tr}</tbody></table>
      <p style="font-size:8pt;color:#64748b">% RL = sobre a receita líquida. Aportes, investimentos e distribuição ficam fora da DRE e entram na geração de caixa.</p>`, mensal && meses.length > 4 ? 'landscape' : 'portrait')
  }
  function csv() {
    if (!dre) return
    baixarCsv(`dre-${regime.toLowerCase()}-${de}-a-${ate}`, ['Linha', 'Tipo', 'Código', 'Descrição', ...meses.map(mesCurto), 'Total', '% receita líquida'],
      dre.map((l) => [l.chave, l.tipo, l.conta ? fmtCodigoCurto(l.conta.codigo) : '', l.rotulo, ...meses.map((m) => l.porMes[m] ?? 0), l.total, rl ? Math.round((l.total / rl) * 1000) / 10 : '']))
  }

  return (
    <div className="flex h-full flex-col">
      <div className="barra">
        <Titulo>DRE gerencial</Titulo>
        <BotaoAtualizar onClick={carregar} />
        <Campo label="Período">
          <select className="input" value={atalho} onChange={(e) => escolherAtalho(e.target.value as AtalhoPeriodo)}>
            {Object.entries(ATALHOS_PERIODO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Campo>
        <Campo label="De"><input className="input" type="date" value={de} onChange={(e) => { if (e.target.value) { setDe(e.target.value); setAtalho('PERSONALIZADO') } }} /></Campo>
        <Campo label="Até"><input className="input" type="date" value={ate} onChange={(e) => { if (e.target.value) { setAte(e.target.value); setAtalho('PERSONALIZADO') } }} /></Campo>
        <div className="flex overflow-hidden rounded-md border border-slate-300" title="Competência: receitas e despesas no mês a que pertencem. Caixa: quando o dinheiro entrou ou saiu.">
          {(Object.keys(REGIMES) as Regime[]).map((k) => <button key={k} className={`px-2 py-1 font-semibold ${regime === k ? 'bg-grafite-900 text-white' : 'bg-white text-slate-600'}`} onClick={() => setRegime(k)}>{REGIMES[k]}</button>)}
        </div>
        <div className="flex overflow-hidden rounded-md border border-slate-300">
          <button className={`px-2 py-1 font-semibold ${!mensal ? 'bg-grafite-900 text-white' : 'bg-white text-slate-600'}`} onClick={() => setMensal(false)}>Total</button>
          <button className={`px-2 py-1 font-semibold ${mensal ? 'bg-grafite-900 text-white' : 'bg-white text-slate-600'}`} onClick={() => setMensal(true)}>Mês a mês</button>
        </div>
        <div className="ml-auto flex gap-1.5">
          <button className="btn-secondary" onClick={() => setAbertos(abertos.size ? new Set() : new Set(gruposComContas))}>{abertos.size ? 'Recolher contas' : 'Abrir contas'}</button>
          <button className="btn-secondary" onClick={csv} disabled={!dre}>⬇ CSV</button>
          <button className="btn-secondary" onClick={imprimir} disabled={!dre}>🖨️</button>
        </div>
      </div>
      {!dre ? <Carregando /> : (
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="card overflow-auto">
            <table className="tabela">
              <thead><tr><th className="min-w-[16rem]">Descrição</th>{colunasMes.map((m) => <th key={m} className="num">{mesCurto(m)}</th>)}<th className="num">Total</th><th className="num" title="Sobre a receita líquida">% RL</th></tr></thead>
              <tbody>
                {visiveis.map((l) => {
                  const expansivel = (l.tipo === 'grupo' || l.tipo === 'fora') && gruposComContas.has(l.grupo as GrupoPlano)
                  const cls = destaque(l) ? 'font-extrabold text-grafite-900 bg-grafite-100' : l.tipo === 'conta' ? 'text-slate-600' : 'font-semibold'
                  const neg = (v: number) => (v < 0 && destaque(l) ? 'text-red-700' : '')
                  return (
                    <tr key={l.chave} className={expansivel ? 'cursor-pointer hover:bg-grafite-50' : ''} onClick={expansivel ? () => alternar(l.grupo as string) : undefined}>
                      <td className={cls} style={l.tipo === 'conta' ? { paddingLeft: `${0.5 + (l.nivel ?? 1) * 0.9}rem` } : undefined}>
                        {expansivel && <span className="mr-1 inline-block w-3 text-slate-400">{abertos.has(l.grupo as string) ? '▾' : '▸'}</span>}
                        {l.tipo === 'conta' ? <>{l.conta && <span className="mr-1 font-mono text-[10px] text-slate-400">{fmtCodigoCurto(l.conta.codigo)}</span>}<span className={l.nivel === 1 ? 'font-semibold' : ''}>{l.rotulo}</span></> : l.rotulo}
                      </td>
                      {colunasMes.map((m) => <td key={m} className={`num ${cls} ${neg(l.porMes[m] ?? 0)}`}>{fmtValor(l.porMes[m] ?? 0)}</td>)}
                      <td className={`num ${cls} ${neg(l.total)}`}>{fmtValor(l.total)}</td>
                      <td className={`num text-slate-500 ${destaque(l) ? 'font-bold' : ''}`}>{pct(l)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-1.5 text-[11px] text-slate-500">
            {regime === 'COMPETENCIA'
              ? 'Competência: títulos a pagar e a receber (não cancelados) pelo mês de competência, mais os lançamentos avulsos e os juros/descontos das baixas.'
              : 'Caixa: lançamentos confirmados pela data em que o dinheiro entrou ou saiu.'}
            {' '}Clique num grupo para ver os centros de custo. Aportes, investimentos e distribuição de lucros ficam fora da DRE e entram na geração de caixa.
          </p>
        </div>
      )}
    </div>
  )
}
