// Orçamento (0003/0004): previsão por centro de custo (2º nível para baixo) e mês. Edita na grade, gera a partir do
// realizado de um ano-base com reajuste (IPCA do Banco Central como sugestão) e compara previsto × realizado (caixa).
import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase, ok } from '@/lib/supabase'
import { listarPlano, rpc, todas } from '@/lib/dados'
import { useAuth } from '@/lib/auth'
import { fmtDataHora, fmtPct, fmtValor, hojeISO, mascaraMoeda, MESES, MESES_CURTOS, parsePreco, somar } from '@/lib/format'
import { fmtCodigoCurto, raizDoCodigo } from '@/lib/planoContas'
import { baixarCsv } from '@/lib/csv'
import { cabecalhoImpressao, escHtml, imprimirHtml } from '@/lib/imprimir'
import { nomeDaEmpresa, useDadosEmpresa } from '@/lib/empresa'
import { ehFinanceiro, type OrcamentoLinha, type OrcamentoParametro, type PlanoConta, type TipoMovimento } from '@/lib/types'
import { BotaoAtualizar, Campo, Carregando, Confirmar, Modal, Titulo, useToast } from '@/components/ui'

const MESES_N = Array.from({ length: 12 }, (_, i) => i + 1)
const chave = (plano: number, mes: number) => `${plano}-${mes}`
interface GrupoGrade { raiz: PlanoConta; contas: PlanoConta[] }

export default function Orcamento() {
  const { toast } = useToast()
  const { perfil, empresa } = useAuth()
  const dadosEmpresa = useDadosEmpresa()
  const pode = ehFinanceiro(perfil)
  const hoje = hojeISO()
  const [ano, setAno] = useState(Number(hoje.slice(0, 4)) + (Number(hoje.slice(5, 7)) >= 11 ? 1 : 0))
  const [visao, setVisao] = useState<'previsto' | 'comparar'>('previsto')
  const [planos, setPlanos] = useState<PlanoConta[] | null>(null)
  const [valores, setValores] = useState<Map<string, number> | null>(null)
  const [textos, setTextos] = useState<Record<string, string>>({})
  const [comparar, setComparar] = useState<OrcamentoLinha[] | null>(null)
  const [param, setParam] = useState<OrcamentoParametro | null>(null)
  const [ateMes, setAteMes] = useState(12)
  const [todasContas, setTodasContas] = useState(false)
  const [gerar, setGerar] = useState<{ base: number; reajuste: string; fonte: string } | null>(null)
  const [confirmaGerar, setConfirmaGerar] = useState(false)
  const [buscandoIpca, setBuscandoIpca] = useState(false)

  useEffect(() => { listarPlano(false).then(setPlanos).catch((e) => toast(e.message, 'erro')) }, [])
  async function carregar() {
    setValores(null); setComparar(null)
    try {
      const [orc, cmp, par] = await Promise.all([
        todas<{ plano_conta_id: number; mes: number; valor: number }>((a, b) => supabase.from('orcamento').select('plano_conta_id, mes, valor').eq('ano', ano).order('plano_conta_id').order('mes').range(a, b)),
        todas<OrcamentoLinha>((a, b) => supabase.from('v_orcamento').select('*').eq('ano', ano).order('codigo').order('mes').range(a, b)),
        Promise.resolve(supabase.from('orcamento_parametro').select('*').eq('ano', ano).maybeSingle()).then((r) => ok(r) as OrcamentoParametro | null),
      ])
      setValores(new Map(orc.map((o) => [chave(o.plano_conta_id, o.mes), Number(o.valor)])))
      setTextos({}); setComparar(cmp); setParam(par)
    } catch (e: any) { toast(e.message, 'erro'); setValores(new Map()); setComparar([]) }
  }
  useEffect(() => { carregar(); setAteMes(ano === Number(hoje.slice(0, 4)) ? Number(hoje.slice(5, 7)) : 12) }, [ano])

  const v = (p: number, m: number) => valores?.get(chave(p, m)) ?? 0
  const totalConta = (p: number) => somar(MESES_N.map((m) => v(p, m)))
  // grade: contas do 2º nível para baixo (ativas, ou com orçamento), agrupadas pela conta do 1º nível; entradas e depois saídas
  const grade = useMemo(() => {
    if (!planos || !valores) return { ENTRADA: [], SAIDA: [] } as Record<TipoMovimento, GrupoGrade[]>
    const comValor = new Set([...valores.keys()].map((k) => Number(k.split('-')[0])))
    const r: Record<TipoMovimento, GrupoGrade[]> = { ENTRADA: [], SAIDA: [] }
    for (const raiz of planos.filter((p) => p.nivel === 1).sort((a, b) => a.codigo - b.codigo)) {
      const contas = planos.filter((p) => p.nivel > 1 && raizDoCodigo(p.codigo) === raiz.codigo && (comValor.has(p.id) || (p.ativa && (todasContas || pode))))
        .filter((p) => todasContas || comValor.has(p.id) || !planos.some((f) => f.pai_id === p.id))   // sem "todas": só as folhas (onde se lança)
        .sort((a, b) => a.codigo - b.codigo)
      if (contas.length) r[raiz.tipo].push({ raiz, contas })
    }
    return r
  }, [planos, valores, todasContas, pode])
  const somaGrupo = (g: GrupoGrade, m?: number) => somar(g.contas.map((c) => (m ? v(c.id, m) : totalConta(c.id))))
  const somaTipo = (t: TipoMovimento, m?: number) => somar(grade[t].map((g) => somaGrupo(g, m)))

  async function gravar(plano: number, mes: number, texto: string) {
    const novo = parsePreco(texto) ?? 0
    const k = chave(plano, mes)
    setTextos((t) => { const x = { ...t }; delete x[k]; return x })
    if (novo === v(plano, mes)) return
    if (novo < 0) { toast('O orçamento não aceita valor negativo', 'erro'); return }
    try {
      if (novo === 0) ok(await supabase.from('orcamento').delete().eq('ano', ano).eq('plano_conta_id', plano).eq('mes', mes))
      else ok(await supabase.from('orcamento').upsert({ empresa_id: empresa!.empresa_id, ano, plano_conta_id: plano, mes, valor: novo }, { onConflict: 'empresa_id,ano,plano_conta_id,mes' }))
      setValores((m) => { const n = new Map(m); if (novo === 0) n.delete(k); else n.set(k, novo); return n })
    } catch (e: any) { toast(e.message, 'erro') }
  }
  async function repetirLinha(plano: number) {
    const base = MESES_N.map((m) => v(plano, m)).find((x) => x > 0)
    if (!base) { toast('Digite o valor de um mês primeiro', 'info'); return }
    try {
      ok(await supabase.from('orcamento').upsert(MESES_N.map((mes) => ({ empresa_id: empresa!.empresa_id, ano, plano_conta_id: plano, mes, valor: base })), { onConflict: 'empresa_id,ano,plano_conta_id,mes' }))
      setValores((m) => { const n = new Map(m); MESES_N.forEach((mes) => n.set(chave(plano, mes), base)); return n })
      toast(`${fmtValor(base)} repetido nos 12 meses`)
    } catch (e: any) { toast(e.message, 'erro') }
  }
  async function buscarIpca() {
    setBuscandoIpca(true)
    try {
      const r = await fetch('https://api.bcb.gov.br/dados/serie/bcdata.sgs.13522/dados/ultimos/1?formato=json')
      const j = (await r.json()) as { data: string; valor: string }[]
      const x = j?.[0]
      if (!x?.valor) throw new Error('resposta vazia')
      setGerar((g) => g && { ...g, reajuste: String(x.valor).replace('.', ','), fonte: `IPCA acumulado 12 meses (BCB, ${x.data})` })
    } catch { toast('Não foi possível buscar o IPCA no Banco Central. Digite o percentual.', 'erro') } finally { setBuscandoIpca(false) }
  }
  async function executarGerar() {
    if (!gerar) return
    setConfirmaGerar(false)
    try {
      const n = await rpc<number>('gerar_orcamento', { p_ano: ano, p_ano_base: gerar.base, p_reajuste_pct: parsePreco(gerar.reajuste) ?? 0, p_fonte: gerar.fonte || null })
      toast(`Orçamento de ${ano} gerado: ${n} valor(es) mensais`)
      setGerar(null); carregar()
    } catch (e: any) { toast(e.message, 'erro') }
  }

  // ---------- previsto × realizado ----------
  const cmp = useMemo(() => {
    const m = new Map<number, { l: OrcamentoLinha; previsto: number; realizado: number }>()
    for (const l of comparar ?? []) {
      if (l.mes > ateMes) continue
      const x = m.get(l.plano_conta_id) ?? { l, previsto: 0, realizado: 0 }
      x.previsto = somar([x.previsto, l.valor]); x.realizado = somar([x.realizado, l.realizado]); m.set(l.plano_conta_id, x)
    }
    const porTipo = (t: TipoMovimento) => {
      const g = new Map<number, { raiz: string; itens: typeof lista }>()
      const lista = [...m.values()].filter((x) => x.l.tipo === t).sort((a, b) => a.l.codigo - b.l.codigo)
      for (const x of lista) { const y = g.get(x.l.raiz_codigo) ?? { raiz: x.l.raiz, itens: [] }; y.itens.push(x); g.set(x.l.raiz_codigo, y) }
      return [...g.entries()].sort(([a], [b]) => a - b).map(([, y]) => ({ ...y, previsto: somar(y.itens.map((i) => i.previsto)), realizado: somar(y.itens.map((i) => i.realizado)) }))
    }
    return { ENTRADA: porTipo('ENTRADA'), SAIDA: porTipo('SAIDA') }
  }, [comparar, ateMes])
  const corExec = (t: TipoMovimento, prev: number, real: number) => {
    if (!prev) return 'text-slate-400'
    const p = real / prev
    return t === 'SAIDA' ? (p > 1 ? 'text-red-700 font-bold' : 'text-emerald-700') : (p >= 1 ? 'text-emerald-700' : p < 0.8 ? 'text-red-700' : 'text-amber-700')
  }

  function imprimir() {
    const tit = visao === 'previsto' ? `Orçamento ${ano}` : `Orçamento ${ano} · previsto × realizado${ateMes < 12 ? ` até ${MESES[ateMes - 1]}` : ''}`
    let corpo = ''
    if (visao === 'previsto') {
      const tipo = (t: TipoMovimento, rot: string) => `<tr><td colspan="14" style="font-weight:800;background:#eceff2">${rot}</td></tr>` + grade[t].map((g) =>
        `<tr><td style="font-weight:700">${escHtml(g.raiz.nome)}</td>${MESES_N.map((m) => `<td class="num" style="font-weight:700">${fmtValor(somaGrupo(g, m))}</td>`).join('')}<td class="num" style="font-weight:700">${fmtValor(somaGrupo(g))}</td></tr>`
        + g.contas.map((c) => `<tr><td style="padding-left:12px">${fmtCodigoCurto(c.codigo)} ${escHtml(c.nome)}</td>${MESES_N.map((m) => `<td class="num">${v(c.id, m) ? fmtValor(v(c.id, m)) : ''}</td>`).join('')}<td class="num">${fmtValor(totalConta(c.id))}</td></tr>`).join('')).join('')
        + `<tr><td style="font-weight:800">Total ${rot.toLowerCase()}</td>${MESES_N.map((m) => `<td class="num" style="font-weight:800">${fmtValor(somaTipo(t, m))}</td>`).join('')}<td class="num" style="font-weight:800">${fmtValor(somaTipo(t))}</td></tr>`
      corpo = `<table class="tabela"><thead><tr><th>Centro de custo</th>${MESES_CURTOS.map((m) => `<th class="num">${m}</th>`).join('')}<th class="num">Total</th></tr></thead><tbody>${tipo('ENTRADA', 'Entradas')}${tipo('SAIDA', 'Saídas')}
        <tr><td style="font-weight:800">Resultado previsto</td>${MESES_N.map((m) => `<td class="num" style="font-weight:800">${fmtValor(somaTipo('ENTRADA', m) - somaTipo('SAIDA', m))}</td>`).join('')}<td class="num" style="font-weight:800">${fmtValor(somaTipo('ENTRADA') - somaTipo('SAIDA'))}</td></tr></tbody></table>`
    } else {
      const tipo = (t: TipoMovimento, rot: string) => `<tr><td colspan="5" style="font-weight:800;background:#eceff2">${rot}</td></tr>` + cmp[t].map((g) =>
        `<tr><td style="font-weight:700">${escHtml(g.raiz)}</td><td class="num">${fmtValor(g.previsto)}</td><td class="num">${fmtValor(g.realizado)}</td><td class="num">${fmtValor(g.realizado - g.previsto)}</td><td class="num">${g.previsto ? fmtPct(g.realizado / g.previsto) : '—'}</td></tr>`
        + g.itens.map((i) => `<tr><td style="padding-left:12px">${fmtCodigoCurto(i.l.codigo)} ${escHtml(i.l.plano)}</td><td class="num">${fmtValor(i.previsto)}</td><td class="num">${fmtValor(i.realizado)}</td><td class="num">${fmtValor(i.realizado - i.previsto)}</td><td class="num">${i.previsto ? fmtPct(i.realizado / i.previsto) : '—'}</td></tr>`).join('')).join('')
      corpo = `<table class="tabela"><thead><tr><th>Centro de custo</th><th class="num">Previsto</th><th class="num">Realizado</th><th class="num">Diferença</th><th class="num">Execução</th></tr></thead><tbody>${tipo('ENTRADA', 'Entradas')}${tipo('SAIDA', 'Saídas')}</tbody></table>`
    }
    imprimirHtml(tit, `${cabecalhoImpressao(nomeDaEmpresa(dadosEmpresa), tit, param ? `Gerado do realizado de ${param.ano_base} com reajuste de ${fmtValor(param.reajuste_pct)}%${param.fonte_reajuste ? ` (${param.fonte_reajuste})` : ''}` : undefined)}${corpo}`, visao === 'previsto' ? 'landscape' : 'portrait')
  }
  function csv() {
    if (visao === 'previsto') {
      const linhas = (['ENTRADA', 'SAIDA'] as TipoMovimento[]).flatMap((t) => grade[t].flatMap((g) => g.contas.map((c) => [t === 'ENTRADA' ? 'Entrada' : 'Saída', g.raiz.nome, fmtCodigoCurto(c.codigo), c.nome, ...MESES_N.map((m) => v(c.id, m)), totalConta(c.id)])))
      baixarCsv(`orcamento-${ano}`, ['Tipo', 'Centro pai', 'Código', 'Centro de custo', ...MESES_CURTOS, 'Total'], linhas)
    } else {
      const linhas = (['ENTRADA', 'SAIDA'] as TipoMovimento[]).flatMap((t) => cmp[t].flatMap((g) => g.itens.map((i) => [t === 'ENTRADA' ? 'Entrada' : 'Saída', g.raiz, fmtCodigoCurto(i.l.codigo), i.l.plano, i.previsto, i.realizado, i.realizado - i.previsto, i.previsto ? Math.round((i.realizado / i.previsto) * 1000) / 10 : ''])))
      baixarCsv(`orcamento-${ano}-previsto-x-realizado`, ['Tipo', 'Centro pai', 'Código', 'Centro de custo', 'Previsto', 'Realizado', 'Diferença', 'Execução %'], linhas)
    }
  }

  const celula = (c: PlanoConta, m: number) => {
    const k = chave(c.id, m)
    const texto = textos[k] ?? (v(c.id, m) ? fmtValor(v(c.id, m)) : '')
    return pode
      ? <input className="w-full min-w-[4.5rem] rounded border border-transparent bg-yellow-50/60 px-1 py-0.5 text-right tabular-nums hover:border-slate-300 focus:border-laranja-500 focus:outline-none" inputMode="decimal"
          value={texto} onChange={(e) => setTextos((t) => ({ ...t, [k]: mascaraMoeda(e.target.value) }))} onBlur={(e) => gravar(c.id, m, e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
      : <span>{texto}</span>
  }
  const blocoTipo = (t: TipoMovimento, rot: string) => (
    <>
      <tr><td colSpan={15} className="bg-grafite-100 font-extrabold text-grafite-900">{rot}</td></tr>
      {grade[t].map((g) => (
        <Fragment key={g.raiz.id}>
          <tr><td className="font-bold">{g.raiz.nome}</td>{MESES_N.map((m) => <td key={m} className="num font-bold">{fmtValor(somaGrupo(g, m))}</td>)}<td className="num font-bold">{fmtValor(somaGrupo(g))}</td><td></td></tr>
          {g.contas.map((c) => (
            <tr key={c.id}>
              <td className="whitespace-nowrap text-slate-700" style={{ paddingLeft: `${0.4 + (c.nivel - 1) * 0.7}rem` }}><span className="mr-1 font-mono text-[10px] text-slate-400">{fmtCodigoCurto(c.codigo)}</span>{c.nome}</td>
              {MESES_N.map((m) => <td key={m} className="num !px-0.5">{celula(c, m)}</td>)}
              <td className="num font-semibold">{fmtValor(totalConta(c.id))}</td>
              <td>{pode && <button className="px-1 text-slate-400 hover:text-grafite-900" title="Repetir nos 12 meses o primeiro valor digitado" onClick={() => repetirLinha(c.id)}>⇉</button>}</td>
            </tr>
          ))}
        </Fragment>
      ))}
      <tr><td className="font-extrabold">Total {rot.toLowerCase()}</td>{MESES_N.map((m) => <td key={m} className="num font-extrabold">{fmtValor(somaTipo(t, m))}</td>)}<td className="num font-extrabold">{fmtValor(somaTipo(t))}</td><td></td></tr>
    </>
  )
  const blocoCmp = (t: TipoMovimento, rot: string) => (
    <>
      <tr><td colSpan={5} className="bg-grafite-100 font-extrabold text-grafite-900">{rot}</td></tr>
      {cmp[t].map((g) => (
        <Fragment key={g.raiz}>
          <tr><td className="font-bold">{g.raiz}</td><td className="num font-bold">{fmtValor(g.previsto)}</td><td className="num font-bold">{fmtValor(g.realizado)}</td><td className="num font-bold">{fmtValor(g.realizado - g.previsto)}</td><td className={`num font-bold ${corExec(t, g.previsto, g.realizado)}`}>{g.previsto ? fmtPct(g.realizado / g.previsto) : '—'}</td></tr>
          {g.itens.map((i) => {
            const p = i.previsto ? Math.min(1.5, i.realizado / i.previsto) : 0
            return (
              <tr key={i.l.plano_conta_id}>
                <td className="pl-5 text-slate-700"><span className="mr-1 font-mono text-[10px] text-slate-400">{fmtCodigoCurto(i.l.codigo)}</span>{i.l.plano}</td>
                <td className="num">{fmtValor(i.previsto)}</td><td className="num">{fmtValor(i.realizado)}</td><td className="num">{fmtValor(i.realizado - i.previsto)}</td>
                <td className={`num ${corExec(t, i.previsto, i.realizado)}`}>
                  <span className="mr-1 inline-block h-1.5 w-12 overflow-hidden rounded bg-slate-200 align-middle"><span className="block h-full" style={{ width: `${(p / 1.5) * 100}%`, background: t === 'SAIDA' && p > 1 ? '#dc2626' : '#059669' }} /></span>
                  {i.previsto ? fmtPct(i.realizado / i.previsto) : '—'}
                </td>
              </tr>
            )
          })}
        </Fragment>
      ))}
    </>
  )
  const totCmp = (t: TipoMovimento) => ({ p: somar(cmp[t].map((g) => g.previsto)), r: somar(cmp[t].map((g) => g.realizado)) })

  if (!planos) return <Carregando />
  return (
    <div className="flex h-full flex-col">
      <div className="barra">
        <Titulo>Orçamento</Titulo>
        <BotaoAtualizar onClick={carregar} />
        <div className="flex items-center gap-1">
          <button className="btn-secondary py-0.5" onClick={() => setAno(ano - 1)}>◀</button>
          <input className="input w-20 min-w-0" type="number" value={ano} onChange={(e) => Number(e.target.value) > 2000 && setAno(Number(e.target.value))} />
          <button className="btn-secondary py-0.5" onClick={() => setAno(ano + 1)}>▶</button>
        </div>
        <div className="flex overflow-hidden rounded-md border border-slate-300">
          <button className={`px-2 py-1 font-semibold ${visao === 'previsto' ? 'bg-grafite-900 text-white' : 'bg-white text-slate-600'}`} onClick={() => setVisao('previsto')}>Previsto</button>
          <button className={`px-2 py-1 font-semibold ${visao === 'comparar' ? 'bg-grafite-900 text-white' : 'bg-white text-slate-600'}`} onClick={() => setVisao('comparar')}>Previsto × realizado</button>
        </div>
        {visao === 'previsto'
          ? <label className="flex items-center gap-1" title="Mostrar também as contas que agrupam outras (sem lançamento direto)"><input type="checkbox" checked={todasContas} onChange={(e) => setTodasContas(e.target.checked)} /> todas as contas</label>
          : <Campo label="Até"><select className="input" value={ateMes} onChange={(e) => setAteMes(Number(e.target.value))}>{MESES.map((m, i) => <option key={m} value={i + 1}>{i === 11 ? 'Ano inteiro' : m}</option>)}</select></Campo>}
        <div className="ml-auto flex gap-1.5">
          {pode && <button className="btn-secondary" onClick={() => setGerar({ base: ano - 1, reajuste: '', fonte: '' })}>⚙️ Gerar a partir de um ano-base</button>}
          <button className="btn-secondary" onClick={csv}>⬇ CSV</button>
          <button className="btn-secondary" onClick={imprimir}>🖨️</button>
        </div>
      </div>
      {param && <div className="mb-1.5 text-[11px] text-slate-500">Gerado em {fmtDataHora(param.gerado_em)} do realizado de {param.ano_base} com reajuste de {fmtValor(param.reajuste_pct)}%{param.fonte_reajuste ? ` (${param.fonte_reajuste})` : ''}.</div>}
      {!valores || !comparar ? <Carregando /> : visao === 'previsto' ? (
        <div className="card flex-1 min-h-0 overflow-auto">
          {grade.ENTRADA.length + grade.SAIDA.length === 0 ? <div className="p-6 text-center text-sm text-slate-500">Nenhum orçamento para {ano}.{pode ? ' Digite os valores na grade (marque "todas as contas") ou gere a partir de um ano-base.' : ''}</div> : (
            <table className="tabela">
              <thead><tr><th className="min-w-[14rem]">Centro de custo</th>{MESES_CURTOS.map((m) => <th key={m} className="num">{m}</th>)}<th className="num">Total</th><th></th></tr></thead>
              <tbody>
                {blocoTipo('ENTRADA', 'Entradas')}
                {blocoTipo('SAIDA', 'Saídas')}
              </tbody>
              <tfoot><tr><td>Resultado previsto</td>{MESES_N.map((m) => { const r = somaTipo('ENTRADA', m) - somaTipo('SAIDA', m); return <td key={m} className={`num ${r < 0 ? 'text-red-700' : ''}`}>{fmtValor(r)}</td> })}<td className="num">{fmtValor(somaTipo('ENTRADA') - somaTipo('SAIDA'))}</td><td></td></tr></tfoot>
            </table>
          )}
          {pode && <p className="p-2 text-[11px] text-slate-500">Digite e saia da célula (ou Enter) para gravar; valor vazio ou zero apaga. ⇉ repete o primeiro valor nos 12 meses.</p>}
        </div>
      ) : (
        <div className="card flex-1 min-h-0 overflow-auto">
          {cmp.ENTRADA.length + cmp.SAIDA.length === 0 ? <div className="p-6 text-center text-sm text-slate-500">Nenhum orçamento para {ano}.</div> : (
            <table className="tabela">
              <thead><tr><th>Centro de custo</th><th className="num">Previsto</th><th className="num">Realizado</th><th className="num">Diferença</th><th className="num">Execução</th></tr></thead>
              <tbody>{blocoCmp('ENTRADA', 'Entradas')}{blocoCmp('SAIDA', 'Saídas')}</tbody>
              <tfoot>
                {(['ENTRADA', 'SAIDA'] as TipoMovimento[]).map((t) => { const x = totCmp(t); return <tr key={t}><td>Total {t === 'ENTRADA' ? 'entradas' : 'saídas'}</td><td className="num">{fmtValor(x.p)}</td><td className="num">{fmtValor(x.r)}</td><td className="num">{fmtValor(x.r - x.p)}</td><td className={`num ${corExec(t, x.p, x.r)}`}>{x.p ? fmtPct(x.r / x.p) : '—'}</td></tr> })}
                <tr><td>Resultado</td><td className="num">{fmtValor(totCmp('ENTRADA').p - totCmp('SAIDA').p)}</td><td className="num">{fmtValor(totCmp('ENTRADA').r - totCmp('SAIDA').r)}</td><td className="num">{fmtValor((totCmp('ENTRADA').r - totCmp('SAIDA').r) - (totCmp('ENTRADA').p - totCmp('SAIDA').p))}</td><td></td></tr>
              </tfoot>
            </table>
          )}
          <p className="p-2 text-[11px] text-slate-500">Realizado pelo regime de caixa (lançamentos confirmados pela data), só nas contas que têm orçamento. Saídas: verde até 100% do previsto, vermelho acima. Entradas: verde a partir de 100%.</p>
        </div>
      )}

      <Modal aberto={!!gerar} titulo={`Gerar o orçamento de ${ano}`} onFechar={() => setGerar(null)} largura="max-w-md">
        {gerar && (
          <div className="ficha grid grid-cols-2 gap-2 text-sm">
            <Campo label="Ano-base (realizado)"><input className="input" type="number" value={gerar.base} onChange={(e) => setGerar({ ...gerar, base: Number(e.target.value) })} /></Campo>
            <Campo label="Reajuste (%)"><input className="input text-right" inputMode="decimal" value={gerar.reajuste} onChange={(e) => setGerar({ ...gerar, reajuste: e.target.value.replace(/[^\d,.-]/g, '') })} placeholder="ex.: 4,5" /></Campo>
            <Campo label="Fonte do reajuste" className="col-span-2"><input className="input" value={gerar.fonte} onChange={(e) => setGerar({ ...gerar, fonte: e.target.value })} placeholder="ex.: IPCA, dissídio, contrato" /></Campo>
            <div className="col-span-2"><button className="btn-secondary" disabled={buscandoIpca} onClick={buscarIpca}>{buscandoIpca ? 'Buscando…' : '📈 Buscar IPCA 12 meses (Banco Central)'}</button></div>
            <p className="col-span-2 text-[11px] text-slate-500">Cada conta recebe, mês a mês, o realizado do ano-base com o reajuste; meses do ano-base que ainda não terminaram usam a média dos meses com valor. Depois dá para ajustar na grade.</p>
            <div className="acoes col-span-2 flex justify-end gap-2"><button className="btn-secondary" onClick={() => setGerar(null)}>Cancelar</button><button className="btn-primary" onClick={() => setConfirmaGerar(true)}>Gerar</button></div>
          </div>
        )}
      </Modal>
      <Confirmar aberto={confirmaGerar} perigo titulo="Gerar orçamento" texto={`Isto substitui todo o orçamento de ${ano} pelo realizado de ${gerar?.base} com ${gerar?.reajuste || '0'}% de reajuste. Continuar?`} onNao={() => setConfirmaGerar(false)} onSim={executarGerar} />
    </div>
  )
}
