export const fmtMoeda = (v: number | string | null | undefined) =>
  Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export const fmtNum = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR')

/** percentual com 1 casa: 0.123 → '12,3%' (recebe fração) */
export const fmtPct = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`

/** 'YYYY-MM-DD' -> 'DD/MM/YYYY' (sem conversão de fuso) */
export const fmtData = (iso: string | null | undefined) => {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}
/** 'YYYY-MM-DD' -> 'DD/MM' */
export const fmtDiaMes = (iso: string | null | undefined) => (iso ? fmtData(iso).slice(0, 5) : '')

export const fmtDataHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''

export const hojeISO = () => dataLocalISO(new Date())
/** Data local (sem fuso) de um Date → 'YYYY-MM-DD' */
export const dataLocalISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
/** soma dias a 'YYYY-MM-DD' */
export const somarDias = (iso: string, dias: number) => { const [y, m, d] = iso.split('-').map(Number); return dataLocalISO(new Date(y, m - 1, d + dias)) }
/** soma meses a 'YYYY-MM-DD' mantendo o dia (31/01 + 1 mês = 28 ou 29/02: último dia do mês) */
export const somarMeses = (iso: string, meses: number) => {
  const [y, m, d] = iso.split('-').map(Number)
  const ultimo = new Date(y, m - 1 + meses + 1, 0).getDate()
  return dataLocalISO(new Date(y, m - 1 + meses, Math.min(d, ultimo)))
}
/** 'YYYY-MM' do mês atual */
export const mesAtual = () => hojeISO().slice(0, 7)
/** primeiro e último dia de 'YYYY-MM' */
export const limitesDoMes = (mes: string) => {
  const [y, m] = mes.split('-').map(Number)
  return { de: `${mes}-01`, ate: `${mes}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}` }
}
/** 'YYYY-MM' + n meses */
export const somarMes = (mes: string, n: number) => { const [y, m] = mes.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

/** Nomes dos meses sempre com a inicial maiúscula em todo o sistema */
export const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
export const MESES_CURTOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
/** 'YYYY-MM' → 'Outubro de 2026' */
export const nomeMes = (mes: string) => { const [y, m] = mes.split('-').map(Number); return `${MESES[m - 1]} de ${y}` }
/** 'YYYY-MM' → 'Out/26' */
export const mesCurto = (mes: string) => { const [y, m] = mes.split('-').map(Number); return `${MESES_CURTOS[m - 1]}/${String(y).slice(2)}` }

export const normalizar = (s: string | null | undefined) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export const somenteDigitos = (s: string) => s.replace(/\D/g, '')

/** Texto digitado ('4,95', '4.95', 'R$ 1.256,10', '-10,00') → número ou null */
export const parsePreco = (s: string | number | null | undefined): number | null => {
  if (s === null || s === undefined || s === '') return null
  if (typeof s === 'number') return s
  const t = s.replace(/[^\d,.-]/g, '')
  const semMilhar = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  const n = Number(semMilhar)
  return Number.isFinite(n) ? n : null
}
/** Número → '1.234,56' (sem R$); vazio para null */
export const fmtValor = (v: number | string | null | undefined) => {
  if (v === null || v === undefined || v === '') return ''
  const n = typeof v === 'number' ? v : parsePreco(v)
  return n == null ? '' : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
/**
 * Máscara monetária enquanto digita: os dígitos entram pelos centavos, sempre com 2 casas e milhar com ponto
 * ('2' → '0,02', '2500' → '25,00', '123456' → '1.234,56'). parsePreco lê o resultado.
 */
export const mascaraMoeda = (s: string) => {
  const digitos = s.replace(/\D/g, '').replace(/^0+/, '').slice(0, 13)
  if (!digitos) return ''
  return (Number(digitos) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
/** soma em centavos (evita 0,1 + 0,2 = 0,30000000000000004) */
export const somar = (valores: (number | string | null | undefined)[]) => Math.round(valores.reduce<number>((s, v) => s + Math.round(Number(v ?? 0) * 100), 0)) / 100

/** Telefone: '31988695820' → '(31) 98869-5820' */
export const fmtTelefone = (s: string | null | undefined) => {
  const d = somenteDigitos(s ?? '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return s ?? ''
}
/** CEP: '35160000' → '35160-000' */
export const fmtCep = (s: string | null | undefined) => { const d = somenteDigitos(s ?? ''); return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : s ?? '' }
