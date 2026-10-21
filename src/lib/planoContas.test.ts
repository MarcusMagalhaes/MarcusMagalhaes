import { describe, expect, it } from 'vitest'
import { contemCodigo, fmtCodigoCurto, fmtCodigoPlano, gruposPlano, proximoCodigo, raizDoCodigo, totaisPorGrupo, valorResultado } from './planoContas'
import type { PlanoConta } from './types'

const c = (id: number, codigo: number, nivel: number, pai_id: number | null, nome: string, extra: Partial<PlanoConta> = {}): PlanoConta =>
  ({ id, codigo, nivel, pai_id, nome, tipo: 'SAIDA', grupo: 'DESPESA_OPERACIONAL', descricao: null, ordem: codigo, ativa: true, ...extra })
const lista = [
  c(1, 1000000, 1, null, 'Receitas', { tipo: 'ENTRADA', grupo: 'RECEITA_OPERACIONAL' }),
  c(2, 1010000, 2, 1, 'Vendas', { tipo: 'ENTRADA', grupo: 'RECEITA_OPERACIONAL' }),
  c(3, 2000000, 1, null, 'Despesas'),
  c(4, 2010000, 2, 3, 'Aluguel'),
  c(5, 2010100, 3, 4, 'Aluguel loja'),
]

describe('centros de custo', () => {
  it('formata o código', () => {
    expect(fmtCodigoPlano(1010000)).toBe('01.01.00.00')
    expect(fmtCodigoCurto(1010000)).toBe('01.01')
    expect(fmtCodigoCurto(2010100)).toBe('02.01.01')
  })
  it('raiz e descendentes', () => {
    expect(raizDoCodigo(2010100)).toBe(2000000)
    expect(contemCodigo(lista[3], 2010100)).toBe(true)
    expect(contemCodigo(lista[3], 2020000)).toBe(false)
  })
  it('próximo código', () => {
    expect(proximoCodigo(lista, null)).toBe(3000000)
    expect(proximoCodigo(lista, lista[2])).toBe(2020000)
    expect(proximoCodigo(lista, lista[3])).toBe(2010200)
  })
  it('agrupa para o select (só do 2º nível para baixo)', () => {
    const g = gruposPlano(lista, (x) => x.tipo === 'SAIDA')
    expect(g).toHaveLength(1)
    expect(g[0].itens.map((i) => i.c.id)).toEqual([4, 5])
  })
  it('DRE: soma por grupo e resultado com sinal', () => {
    const t = totaisPorGrupo([{ p: 2, t: 1000 }, { p: 4, t: 300 }, { p: 5, t: 50 }], lista)
    expect(t.RECEITA_OPERACIONAL).toBe(1000)
    expect(t.DESPESA_OPERACIONAL).toBe(350)
    expect(valorResultado(t, ['RECEITA_OPERACIONAL', 'DESPESA_OPERACIONAL'])).toBe(650)
  })
})
