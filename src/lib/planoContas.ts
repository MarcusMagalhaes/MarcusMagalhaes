// Plano de contas (0002, mesmo desenho dos centros de custo do Luminexus): árvore de até 4 níveis. Código de 8 dígitos,
// 2 por nível: 01000000 (1º nível) → 01010000 → 01010100 → 01010101. O 1º nível agrupa; lançamento, título e orçamento
// só do 2º nível para baixo. `grupo` (classificação na DRE) é escolhido no 1º nível e herdado pelos filhos.
import type { GrupoPlano, PlanoConta, TipoMovimento } from './types'

export const NIVEL_MAX = 4
export const MAX_FILHOS = 99
export const NOME_NIVEL: Record<number, string> = { 1: '1º nível (grupo)', 2: '2º nível', 3: '3º nível', 4: '4º nível' }

/** 1010000 → '01.01.00.00' */
export const fmtCodigoPlano = (codigo: number) => String(codigo).padStart(8, '0').replace(/(\d{2})(?=\d)/g, '$1.')
/** código curto: tira os pares de zeros do fim (01.01) */
export const fmtCodigoCurto = (codigo: number) => fmtCodigoPlano(codigo).replace(/(\.00)+$/, '')
/** código do 1º nível de qualquer código */
export const raizDoCodigo = (codigo: number) => Math.floor(codigo / 1e6) * 1e6
/** a conta `c` contém `codigo` (ela mesma ou qualquer descendente) */
export const contemCodigo = (c: Pick<PlanoConta, 'codigo' | 'nivel'>, codigo: number) =>
  codigo >= c.codigo && codigo < c.codigo + 100 ** (NIVEL_MAX - c.nivel)
/** passo do código de um filho de `pai` (o mesmo do gatilho fn_plano_inclusao) */
export const passoFilho = (pai: Pick<PlanoConta, 'nivel'> | null) => (!pai ? 1e6 : pai.nivel === 1 ? 1e4 : pai.nivel === 2 ? 100 : 1)

/** próximo código (prévia; quem grava é o banco) */
export function proximoCodigo(lista: PlanoConta[], pai: PlanoConta | null): number | string {
  const irmaos = lista.filter((c) => (pai ? c.pai_id === pai.id : c.nivel === 1))
  const passo = passoFilho(pai)
  const max = irmaos.reduce((m, c) => Math.max(m, c.codigo), pai?.codigo ?? 0)
  const prox = max + passo
  if (irmaos.length >= MAX_FILHOS || (pai ? prox >= pai.codigo + passo * 100 : prox > 99e6)) return 'limite atingido'
  return prox
}

export interface GrupoOpcoes { raiz: PlanoConta; itens: { c: PlanoConta; rotulo: string }[] }
/**
 * Um grupo por conta do 1º nível (em ordem de código) com as contas que recebem lançamento (2º nível para baixo)
 * que passam no filtro, recuadas pelo nível — para `<optgroup>`.
 */
export function gruposPlano(lista: PlanoConta[], filtro: (c: PlanoConta) => boolean = () => true): GrupoOpcoes[] {
  const ordem = [...lista].sort((a, b) => a.codigo - b.codigo)
  return ordem.filter((r) => r.nivel === 1).map((raiz) => ({
    raiz,
    itens: ordem.filter((c) => c.nivel > 1 && raizDoCodigo(c.codigo) === raiz.codigo && filtro(c))
      .map((c) => ({ c, rotulo: '   '.repeat(c.nivel - 2) + c.nome })),
  })).filter((g) => g.itens.length > 0)
}

/** nome da conta do 1º nível de um código */
export const nomeRaiz = (lista: PlanoConta[], codigo: number | null | undefined) =>
  codigo == null ? undefined : lista.find((c) => c.nivel === 1 && c.codigo === raizDoCodigo(codigo))?.nome

/** tipo do movimento de um título */
export const movimentoDoTitulo = (tipo: 'PAGAR' | 'RECEBER'): TipoMovimento => (tipo === 'PAGAR' ? 'SAIDA' : 'ENTRADA')

// ---------- DRE gerencial ----------
/** linha da DRE: soma de grupos (sinal + entra, − sai) ou subtotal (resultado acumulado) */
export type LinhaDre =
  | { tipo: 'grupo'; chave: GrupoPlano; rotulo: string; sinal: 1 | -1 }
  | { tipo: 'resultado'; chave: string; rotulo: string; grupos: GrupoPlano[] }

/** estrutura da DRE gerencial (0004, função dre): a tela soma os totais por conta do plano dentro de cada grupo */
export const ESTRUTURA_DRE: LinhaDre[] = [
  { tipo: 'grupo', chave: 'RECEITA_OPERACIONAL', rotulo: 'Receita bruta', sinal: 1 },
  { tipo: 'grupo', chave: 'DEDUCAO', rotulo: '(−) Deduções da receita', sinal: -1 },
  { tipo: 'resultado', chave: 'receita_liquida', rotulo: '= Receita líquida', grupos: ['RECEITA_OPERACIONAL', 'DEDUCAO'] },
  { tipo: 'grupo', chave: 'CUSTO', rotulo: '(−) Custos', sinal: -1 },
  { tipo: 'resultado', chave: 'lucro_bruto', rotulo: '= Lucro bruto', grupos: ['RECEITA_OPERACIONAL', 'DEDUCAO', 'CUSTO'] },
  { tipo: 'grupo', chave: 'DESPESA_OPERACIONAL', rotulo: '(−) Despesas operacionais', sinal: -1 },
  { tipo: 'resultado', chave: 'resultado_operacional', rotulo: '= Resultado operacional', grupos: ['RECEITA_OPERACIONAL', 'DEDUCAO', 'CUSTO', 'DESPESA_OPERACIONAL'] },
  { tipo: 'grupo', chave: 'RECEITA_FINANCEIRA', rotulo: '(+) Receitas financeiras', sinal: 1 },
  { tipo: 'grupo', chave: 'DESPESA_FINANCEIRA', rotulo: '(−) Despesas financeiras', sinal: -1 },
  { tipo: 'grupo', chave: 'OUTRA_RECEITA', rotulo: '(+) Outras receitas', sinal: 1 },
  { tipo: 'resultado', chave: 'antes_impostos', rotulo: '= Resultado antes dos impostos', grupos: ['RECEITA_OPERACIONAL', 'DEDUCAO', 'CUSTO', 'DESPESA_OPERACIONAL', 'RECEITA_FINANCEIRA', 'DESPESA_FINANCEIRA', 'OUTRA_RECEITA'] },
  { tipo: 'grupo', chave: 'IMPOSTO_LUCRO', rotulo: '(−) IRPJ e CSLL', sinal: -1 },
  { tipo: 'resultado', chave: 'resultado_liquido', rotulo: '= Resultado líquido', grupos: ['RECEITA_OPERACIONAL', 'DEDUCAO', 'CUSTO', 'DESPESA_OPERACIONAL', 'RECEITA_FINANCEIRA', 'DESPESA_FINANCEIRA', 'OUTRA_RECEITA', 'IMPOSTO_LUCRO'] },
]
/** fora da DRE, mas no caixa: aparecem abaixo do resultado líquido */
export const FORA_DRE: { chave: GrupoPlano; rotulo: string; sinal: 1 | -1 }[] = [
  { chave: 'APORTE_EMPRESTIMO', rotulo: '(+) Aportes e empréstimos recebidos', sinal: 1 },
  { chave: 'INVESTIMENTO', rotulo: '(−) Investimentos', sinal: -1 },
  { chave: 'DISTRIBUICAO_AMORTIZACAO', rotulo: '(−) Distribuição de lucros e amortizações', sinal: -1 },
]
export const SINAL_GRUPO: Record<GrupoPlano, 1 | -1> = {
  RECEITA_OPERACIONAL: 1, RECEITA_FINANCEIRA: 1, OUTRA_RECEITA: 1, APORTE_EMPRESTIMO: 1,
  DEDUCAO: -1, CUSTO: -1, DESPESA_OPERACIONAL: -1, DESPESA_FINANCEIRA: -1, IMPOSTO_LUCRO: -1, INVESTIMENTO: -1, DISTRIBUICAO_AMORTIZACAO: -1,
}

/** totais da função dre ({p: plano_conta_id, m: 'YYYY-MM', t: total}) somados por grupo, já com o sinal */
export function totaisPorGrupo(linhas: { p: number; t: number }[], planos: PlanoConta[]): Record<GrupoPlano, number> {
  const grupoDe = new Map(planos.map((p) => [p.id, p.grupo]))
  const r = Object.fromEntries(Object.keys(SINAL_GRUPO).map((g) => [g, 0])) as Record<GrupoPlano, number>
  for (const l of linhas) {
    const g = grupoDe.get(l.p)
    if (g) r[g] = Math.round((r[g] + Number(l.t)) * 100) / 100
  }
  return r
}
/** valor de uma linha de resultado (soma com sinal dos grupos) */
export const valorResultado = (totais: Record<GrupoPlano, number>, grupos: GrupoPlano[]) =>
  Math.round(grupos.reduce((s, g) => s + SINAL_GRUPO[g] * totais[g], 0) * 100) / 100
