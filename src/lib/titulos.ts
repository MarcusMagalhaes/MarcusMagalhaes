// Contas a pagar e a receber: geração das parcelas/repetições na inclusão do título (0003, tabela titulo).
// Parcelar divide o valor (os centavos que sobram vão na última); repetir copia o mesmo valor todo mês. Vencimentos
// mensais a partir do primeiro (somarMeses mantém o dia; 31 vira o último dia do mês); competência = mês do vencimento.
import { somarMeses } from './format'

export type Repeticao = 'NAO' | 'PARCELAR' | 'REPETIR'
export const REPETICOES: Record<Repeticao, string> = { NAO: 'Não repetir', PARCELAR: 'Parcelar (divide o valor)', REPETIR: 'Repetir todo mês (mesmo valor)' }

export interface Parcela { parcela: number | null; parcelas: number | null; vencimento: string; competencia: string; valor: number }

/** parcelas de um título novo; `vezes` entre 2 e 120 quando há repetição */
export function gerarParcelas(valor: number, vencimento: string, repeticao: Repeticao, vezes: number): Parcela[] {
  const comp = (v: string) => `${v.slice(0, 7)}-01`
  if (repeticao === 'NAO' || vezes <= 1) return [{ parcela: null, parcelas: null, vencimento, competencia: comp(vencimento), valor }]
  const n = Math.min(Math.max(Math.floor(vezes), 2), 120)
  const centavos = Math.round(valor * 100)
  const base = repeticao === 'PARCELAR' ? Math.floor(centavos / n) : centavos
  return Array.from({ length: n }, (_, i) => {
    const venc = somarMeses(vencimento, i)
    const c = repeticao === 'PARCELAR' && i === n - 1 ? centavos - base * (n - 1) : base
    return { parcela: i + 1, parcelas: n, vencimento: venc, competencia: comp(venc), valor: c / 100 }
  })
}

/** "Aluguel (2/12)" */
export const descricaoParcela = (descricao: string, parcela?: number | null, parcelas?: number | null) =>
  parcelas && parcelas > 1 ? `${descricao} (${parcela}/${parcelas})` : descricao
