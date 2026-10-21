import { describe, expect, it } from 'vitest'
import { celulaCsv, gerarCsv } from './csv'

describe('csv', () => {
  it('escapa e formata', () => {
    expect(celulaCsv(1234.5)).toBe('1234,5')
    expect(celulaCsv('a;b')).toBe('"a;b"')
    expect(celulaCsv('diz "oi"')).toBe('"diz ""oi"""')
    expect(celulaCsv(null)).toBe('')
    expect(celulaCsv(true)).toBe('sim')
  })
  it('neutraliza fórmula', () => {
    expect(celulaCsv('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(celulaCsv('-10,50')).toBe('-10,50')
  })
  it('gera linhas com ;', () => {
    expect(gerarCsv(['A', 'B'], [[1, 'x']])).toBe('A;B\r\n1;x')
  })
})
