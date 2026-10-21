import { describe, expect, it } from 'vitest'
import { descricaoParcela, gerarParcelas } from './titulos'

describe('parcelas de títulos', () => {
  it('sem repetição: um título, competência do vencimento', () => {
    expect(gerarParcelas(100, '2026-10-15', 'NAO', 5)).toEqual([{ parcela: null, parcelas: null, vencimento: '2026-10-15', competencia: '2026-10-01', valor: 100 }])
  })
  it('parcelar divide e põe os centavos que sobram na última', () => {
    const p = gerarParcelas(100, '2026-01-31', 'PARCELAR', 3)
    expect(p.map((x) => x.valor)).toEqual([33.33, 33.33, 33.34])
    expect(p.map((x) => x.vencimento)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31'])
    expect(p.map((x) => x.competencia)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01'])
    expect(p[2]).toMatchObject({ parcela: 3, parcelas: 3 })
  })
  it('repetir mantém o valor', () => {
    const p = gerarParcelas(1500, '2026-11-10', 'REPETIR', 12)
    expect(p).toHaveLength(12)
    expect(p.every((x) => x.valor === 1500)).toBe(true)
    expect(p[11].vencimento).toBe('2027-10-10')
  })
  it('descrição com parcela', () => {
    expect(descricaoParcela('Aluguel', 2, 12)).toBe('Aluguel (2/12)')
    expect(descricaoParcela('Aluguel', null, null)).toBe('Aluguel')
  })
})
