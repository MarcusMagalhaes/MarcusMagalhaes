import { describe, expect, it } from 'vitest'
import { acumularFluxo, mesesDoPeriodo, montarDre, periodoDoAtalho, primeiroNegativo, receitaLiquida, somaNaArvore, totaisPorConta, variacao } from './relatorios'
import type { PlanoConta } from './types'

const c = (id: number, codigo: number, nivel: number, pai_id: number | null, nome: string, extra: Partial<PlanoConta> = {}): PlanoConta =>
  ({ id, codigo, nivel, pai_id, nome, tipo: 'SAIDA', grupo: 'DESPESA_OPERACIONAL', descricao: null, ordem: codigo, ativa: true, ...extra })
const planos = [
  c(1, 1000000, 1, null, 'Receitas', { tipo: 'ENTRADA', grupo: 'RECEITA_OPERACIONAL' }),
  c(2, 1010000, 2, 1, 'Vendas', { tipo: 'ENTRADA', grupo: 'RECEITA_OPERACIONAL' }),
  c(3, 2000000, 1, null, 'Despesas'),
  c(4, 2010000, 2, 3, 'Aluguel'),
  c(5, 2010100, 3, 4, 'Aluguel loja'),
  c(6, 3000000, 1, null, 'Investimentos', { grupo: 'INVESTIMENTO' }),
  c(7, 3010000, 2, 6, 'Máquinas', { grupo: 'INVESTIMENTO' }),
]
const linhas = [
  { p: 2, m: '2026-09', t: 1000 }, { p: 2, m: '2026-10', t: '500.5' },
  { p: 4, m: '2026-10', t: 100 }, { p: 5, m: '2026-10', t: 50 }, { p: 7, m: '2026-10', t: 200 },
]

describe('relatórios', () => {
  it('meses e atalhos de período', () => {
    expect(mesesDoPeriodo('2026-11-15', '2027-02-01')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02'])
    expect(periodoDoAtalho('MES_ANTERIOR', '2026-01-10')).toEqual({ de: '2025-12-01', ate: '2025-12-31' })
    expect(periodoDoAtalho('ULTIMOS_12', '2026-10-21')).toEqual({ de: '2025-11-01', ate: '2026-10-31' })
    expect(periodoDoAtalho('ANO', '2026-10-21')).toEqual({ de: '2026-01-01', ate: '2026-12-31' })
  })
  it('soma pela árvore', () => {
    const pc = totaisPorConta(linhas)
    expect(somaNaArvore(planos[2], planos, pc)).toBe(150)
    expect(somaNaArvore(planos[3], planos, pc, '2026-10')).toBe(150)
    expect(somaNaArvore(planos[1], planos, pc)).toBe(1500.5)
  })
  it('monta a DRE com sinais e resultados', () => {
    const d = montarDre(linhas, planos, ['2026-09', '2026-10'])
    const l = (k: string) => d.find((x) => x.chave === k)!
    expect(l('RECEITA_OPERACIONAL').total).toBe(1500.5)
    expect(l('DESPESA_OPERACIONAL').porMes['2026-10']).toBe(-150)
    expect(l('resultado_operacional').porMes['2026-10']).toBe(350.5)
    expect(l('resultado_liquido').total).toBe(1350.5)
    expect(l('INVESTIMENTO').total).toBe(-200)
    expect(l('geracao_caixa').total).toBe(1150.5)
    expect(receitaLiquida(d)).toBe(1500.5)
    // contas com movimento aparecem abaixo do grupo (o 1º nível soma os filhos)
    expect(d.filter((x) => x.tipo === 'conta' && x.grupo === 'DESPESA_OPERACIONAL').map((x) => [x.rotulo, x.total])).toEqual([['Despesas', -150], ['Aluguel', -150], ['Aluguel loja', -50]])
  })
  it('fluxo de caixa acumulado', () => {
    const p = [{ inicio: '2026-10-01', entradas: 100, saidas: 50, entradas_previstas: 0, saidas_previstas: 300 }, { inicio: '2026-11-01', entradas: 0, saidas: 0, entradas_previstas: 500, saidas_previstas: 0 }]
    const com = acumularFluxo(100, -20, p, true)
    expect(com.map((x) => x.saldo_acumulado)).toEqual([-170, 330])
    expect(primeiroNegativo(com)?.inicio).toBe('2026-10-01')
    expect(acumularFluxo(100, -20, p, false).map((x) => x.saldo_acumulado)).toEqual([150, 150])
  })
  it('variação', () => {
    expect(variacao(150, 100)).toBe(0.5)
    expect(variacao(10, 0)).toBeNull()
  })
})
