// CPF e CNPJ: validação pelos dígitos verificadores e formatação. O banco guarda só os dígitos (0002, parceiro.documento).
import { somenteDigitos } from './format'

const repetido = (d: string) => /^(\d)\1+$/.test(d)

export function cpfValido(s: string | null | undefined): boolean {
  const d = somenteDigitos(s ?? '')
  if (d.length !== 11 || repetido(d)) return false
  const dv = (n: number) => {
    let soma = 0
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i)
    const r = (soma * 10) % 11
    return r === 10 ? 0 : r
  }
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10])
}

export function cnpjValido(s: string | null | undefined): boolean {
  const d = somenteDigitos(s ?? '')
  if (d.length !== 14 || repetido(d)) return false
  const dv = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const soma = pesos.reduce((s, p, i) => s + p * Number(d[i]), 0)
    const r = soma % 11
    return r < 2 ? 0 : 11 - r
  }
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13])
}

/** '11222333000181' → '11.222.333/0001-81'; '12345678909' → '123.456.789-09'; outro tamanho fica como veio */
export function fmtDocumento(s: string | null | undefined): string {
  const d = somenteDigitos(s ?? '')
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
  return s ?? ''
}

/** mensagem de erro do documento para a pessoa (PF = CPF, PJ = CNPJ); null se vazio ou válido */
export function erroDocumento(pessoa: 'PF' | 'PJ', s: string | null | undefined): string | null {
  const d = somenteDigitos(s ?? '')
  if (!d) return null
  if (pessoa === 'PF') return cpfValido(d) ? null : 'CPF inválido'
  return cnpjValido(d) ? null : 'CNPJ inválido'
}
