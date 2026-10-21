import { describe, expect, it } from 'vitest'
import { cnpjValido, cpfValido, erroDocumento, fmtDocumento } from './documento'

describe('documento', () => {
  it('valida CPF', () => {
    expect(cpfValido('123.456.789-09')).toBe(true)
    expect(cpfValido('529.982.247-25')).toBe(true)
    expect(cpfValido('123.456.789-00')).toBe(false)
    expect(cpfValido('111.111.111-11')).toBe(false)
    expect(cpfValido('123')).toBe(false)
  })
  it('valida CNPJ', () => {
    expect(cnpjValido('11.222.333/0001-81')).toBe(true)
    expect(cnpjValido('11.444.777/0001-61')).toBe(true)
    expect(cnpjValido('11.222.333/0001-80')).toBe(false)
    expect(cnpjValido('00.000.000/0000-00')).toBe(false)
  })
  it('formata', () => {
    expect(fmtDocumento('11222333000181')).toBe('11.222.333/0001-81')
    expect(fmtDocumento('12345678909')).toBe('123.456.789-09')
    expect(fmtDocumento('123')).toBe('123')
  })
  it('mensagem por tipo de pessoa', () => {
    expect(erroDocumento('PF', '')).toBeNull()
    expect(erroDocumento('PF', '11222333000181')).toBe('CPF inválido')
    expect(erroDocumento('PJ', '11222333000181')).toBeNull()
  })
})
