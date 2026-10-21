import { describe, expect, it } from 'vitest'
import { fmtValor, limitesDoMes, mascaraMoeda, mesCurto, parsePreco, somar, somarMes, somarMeses } from './format'

describe('format', () => {
  it('lê valores digitados', () => {
    expect(parsePreco('1.256,10')).toBe(1256.1)
    expect(parsePreco('R$ 4,95')).toBe(4.95)
    expect(parsePreco('4.95')).toBe(4.95)
    expect(parsePreco('-10,00')).toBe(-10)
    expect(parsePreco('')).toBeNull()
  })
  it('máscara de moeda entra pelos centavos', () => {
    expect(mascaraMoeda('2')).toBe('0,02')
    expect(mascaraMoeda('123456')).toBe('1.234,56')
    expect(mascaraMoeda('')).toBe('')
  })
  it('nunca mostra -0,00', () => {
    expect(fmtValor(-0)).toBe('0,00')
    expect(fmtValor(-0.001)).toBe('0,00')
  })
  it('soma em centavos', () => {
    expect(somar([0.1, 0.2])).toBe(0.3)
    expect(somar(['10.10', 5, null])).toBe(15.1)
  })
  it('datas e meses', () => {
    expect(somarMeses('2026-01-31', 1)).toBe('2026-02-28')
    expect(somarMeses('2026-10-15', 3)).toBe('2027-01-15')
    expect(somarMes('2026-12', 1)).toBe('2027-01')
    expect(limitesDoMes('2026-02')).toEqual({ de: '2026-02-01', ate: '2026-02-28' })
    expect(mesCurto('2026-10')).toBe('Out/26')
  })
})
