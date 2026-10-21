// Funções puras dos relatórios (DRE, fluxo de caixa, períodos): somam por centro de custo, pela árvore e por mês.
// As telas só desenham; aqui fica a conta, com teste em relatorios.test.ts.
import { contemCodigo, ESTRUTURA_DRE, FORA_DRE, SINAL_GRUPO, valorResultado } from './planoContas'
import { limitesDoMes, somarMes } from './format'
import type { GrupoPlano, PlanoConta } from './types'

/** linha devolvida pela função dre do banco */
export interface LinhaDreBanco { p: number; m: string; t: number | string }

const arred = (v: number) => Math.round(v * 100) / 100

/** 'YYYY-MM' de cada mês entre duas datas (inclusive) */
export function mesesDoPeriodo(de: string, ate: string): string[] {
  const r: string[] = []
  let m = de.slice(0, 7)
  const fim = ate.slice(0, 7)
  while (m <= fim && r.length < 240) { r.push(m); m = somarMes(m, 1) }
  return r
}

export type AtalhoPeriodo = 'MES' | 'MES_ANTERIOR' | 'ANO' | 'ULTIMOS_12' | 'PERSONALIZADO'
export const ATALHOS_PERIODO: Record<AtalhoPeriodo, string> = {
  MES: 'Mês atual', MES_ANTERIOR: 'Mês anterior', ANO: 'Ano atual', ULTIMOS_12: 'Últimos 12 meses', PERSONALIZADO: 'Personalizado',
}
/** datas de um atalho a partir de hoje ('YYYY-MM-DD') */
export function periodoDoAtalho(a: AtalhoPeriodo, hoje: string): { de: string; ate: string } {
  const mes = hoje.slice(0, 7)
  if (a === 'MES_ANTERIOR') return limitesDoMes(somarMes(mes, -1))
  if (a === 'ANO') return { de: `${hoje.slice(0, 4)}-01-01`, ate: `${hoje.slice(0, 4)}-12-31` }
  if (a === 'ULTIMOS_12') return { de: limitesDoMes(somarMes(mes, -11)).de, ate: limitesDoMes(mes).ate }
  return limitesDoMes(mes)
}

/** totais por centro de custo e mês: Map<plano_conta_id, Map<'YYYY-MM', total>> */
export function totaisPorConta(linhas: LinhaDreBanco[]): Map<number, Map<string, number>> {
  const r = new Map<number, Map<string, number>>()
  for (const l of linhas) {
    let m = r.get(l.p)
    if (!m) { m = new Map(); r.set(l.p, m) }
    m.set(l.m, arred((m.get(l.m) ?? 0) + Number(l.t)))
  }
  return r
}

/** soma de uma conta e de todos os descendentes (pela árvore do código); `mes` vazio = todos os meses */
export function somaNaArvore(conta: Pick<PlanoConta, 'codigo' | 'nivel'>, planos: PlanoConta[], porConta: Map<number, Map<string, number>>, mes?: string): number {
  let s = 0
  for (const p of planos) {
    if (!contemCodigo(conta, p.codigo)) continue
    const m = porConta.get(p.id)
    if (!m) continue
    if (mes) s += m.get(mes) ?? 0
    else for (const v of m.values()) s += v
  }
  return arred(s)
}

/** totais (já positivos, sem sinal) por grupo da DRE, num mês ou no período todo */
export function totaisGrupo(planos: PlanoConta[], porConta: Map<number, Map<string, number>>, mes?: string): Record<GrupoPlano, number> {
  const r = Object.fromEntries(Object.keys(SINAL_GRUPO).map((g) => [g, 0])) as Record<GrupoPlano, number>
  for (const p of planos) {
    const m = porConta.get(p.id)
    if (!m) continue
    const v = mes ? m.get(mes) ?? 0 : [...m.values()].reduce((a, b) => a + b, 0)
    r[p.grupo] = arred(r[p.grupo] + v)
  }
  return r
}

/** centros de custo de um grupo da DRE que tiveram movimento (ela ou descendentes), em ordem de código, com o nível */
export function contasDoGrupo(grupo: GrupoPlano, planos: PlanoConta[], porConta: Map<number, Map<string, number>>): PlanoConta[] {
  const doGrupo = planos.filter((p) => p.grupo === grupo).sort((a, b) => a.codigo - b.codigo)
  return doGrupo.filter((c) => doGrupo.some((d) => contemCodigo(c, d.codigo) && porConta.has(d.id)))
}

/** linha pronta da DRE para desenhar/imprimir/exportar */
export interface LinhaDreMontada {
  chave: string; rotulo: string; tipo: 'grupo' | 'resultado' | 'conta' | 'fora' | 'caixa'
  grupo?: GrupoPlano; conta?: PlanoConta; nivel?: number
  /** valores com sinal (receita +, despesa −) por mês e no total */
  porMes: Record<string, number>; total: number
}

/** Monta a DRE inteira: linhas da estrutura, contas de cada grupo, resultados, fora da DRE e geração de caixa */
export function montarDre(linhas: LinhaDreBanco[], planos: PlanoConta[], meses: string[]): LinhaDreMontada[] {
  const porConta = totaisPorConta(linhas)
  const grupoMes = Object.fromEntries(meses.map((m) => [m, totaisGrupo(planos, porConta, m)]))
  const grupoTot = totaisGrupo(planos, porConta)
  const r: LinhaDreMontada[] = []
  const contas = (g: GrupoPlano, sinal: 1 | -1) => contasDoGrupo(g, planos, porConta).map((c): LinhaDreMontada => ({
    chave: `c${c.id}`, rotulo: c.nome, tipo: 'conta', grupo: g, conta: c, nivel: c.nivel,
    porMes: Object.fromEntries(meses.map((m) => [m, sinal * somaNaArvore(c, planos, porConta, m)])),
    total: sinal * somaNaArvore(c, planos, porConta),
  }))
  for (const l of ESTRUTURA_DRE) {
    if (l.tipo === 'grupo') {
      r.push({ chave: l.chave, rotulo: l.rotulo, tipo: 'grupo', grupo: l.chave,
        porMes: Object.fromEntries(meses.map((m) => [m, l.sinal * grupoMes[m][l.chave]])), total: l.sinal * grupoTot[l.chave] })
      r.push(...contas(l.chave, l.sinal))
    } else {
      r.push({ chave: l.chave, rotulo: l.rotulo, tipo: 'resultado',
        porMes: Object.fromEntries(meses.map((m) => [m, valorResultado(grupoMes[m], l.grupos)])), total: valorResultado(grupoTot, l.grupos) })
    }
  }
  for (const f of FORA_DRE) {
    r.push({ chave: f.chave, rotulo: f.rotulo, tipo: 'fora', grupo: f.chave,
      porMes: Object.fromEntries(meses.map((m) => [m, f.sinal * grupoMes[m][f.chave]])), total: f.sinal * grupoTot[f.chave] })
    r.push(...contas(f.chave, f.sinal))
  }
  const todos = Object.keys(SINAL_GRUPO) as GrupoPlano[]
  r.push({ chave: 'geracao_caixa', rotulo: '= Geração de caixa', tipo: 'caixa',
    porMes: Object.fromEntries(meses.map((m) => [m, valorResultado(grupoMes[m], todos)])), total: valorResultado(grupoTot, todos) })
  return r
}

/** receita líquida (base do % vertical da DRE) */
export const receitaLiquida = (linhas: LinhaDreMontada[], mes?: string) => {
  const l = linhas.find((x) => x.chave === 'receita_liquida')
  return l ? (mes ? l.porMes[mes] ?? 0 : l.total) : 0
}

// ---------- Fluxo de caixa ----------
export interface PeriodoFluxo { inicio: string; entradas: number; saidas: number; entradas_previstas: number; saidas_previstas: number }
export interface LinhaFluxo extends PeriodoFluxo { saldo_periodo: number; saldo_acumulado: number }

/** saldo do período e acumulado (a partir do saldo inicial + o previsto antes do período); com previstos ou só o realizado */
export function acumularFluxo(saldoInicial: number, previstoAntes: number, periodos: PeriodoFluxo[], comPrevistos: boolean): LinhaFluxo[] {
  let saldo = arred(Number(saldoInicial) + (comPrevistos ? Number(previstoAntes) : 0))
  return periodos.map((p) => {
    const e = Number(p.entradas), s = Number(p.saidas), ep = comPrevistos ? Number(p.entradas_previstas) : 0, sp = comPrevistos ? Number(p.saidas_previstas) : 0
    const doPeriodo = arred(e - s + ep - sp)
    saldo = arred(saldo + doPeriodo)
    return { inicio: p.inicio, entradas: e, saidas: s, entradas_previstas: ep, saidas_previstas: sp, saldo_periodo: doPeriodo, saldo_acumulado: saldo }
  })
}

/** primeiro período em que o saldo acumulado fica negativo (ou null) */
export const primeiroNegativo = (linhas: LinhaFluxo[]) => linhas.find((l) => l.saldo_acumulado < 0) ?? null

/** variação relativa (atual sobre anterior); null sem base */
export const variacao = (atual: number, anterior: number) => (anterior ? (atual - anterior) / Math.abs(anterior) : null)
