// Acesso a dados compartilhado entre telas
import { supabase, ok } from './supabase'
import type { ContaFinanceira, Parceiro, PlanoConta } from './types'

type Pagina<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

/**
 * Busca todas as linhas de uma consulta, página por página: a API do Supabase devolve no máximo 1.000 linhas por
 * chamada e corta o resto sem avisar. A consulta precisa de ordem estável (termine com uma coluna única, ex.: id).
 */
export async function todas<T>(consulta: (de: number, ate: number) => Pagina<T>, maximo = 50000): Promise<T[]> {
  const linhas: T[] = []
  while (linhas.length < maximo) {
    const pagina = (ok(await consulta(linhas.length, Math.min(linhas.length + 1000, maximo) - 1)) ?? []) as T[]
    if (!pagina.length) break
    linhas.push(...pagina)
    if (pagina.length < 1000) break
  }
  return linhas
}

export const rpc = async <T = unknown>(fn: string, args: Record<string, unknown> = {}) => ok(await supabase.rpc(fn, args)) as T

export const listarContas = async (soAtivas = true) => {
  let q = supabase.from('conta_financeira').select('*').order('tipo').order('nome')
  if (soAtivas) q = q.eq('ativa', true)
  return ok(await q) as ContaFinanceira[]
}
/** centros de custo (tabela plano_conta) em ordem de código */
export const listarPlano = async (soAtivas = true) => {
  let q = supabase.from('plano_conta').select('*').order('codigo')
  if (soAtivas) q = q.eq('ativa', true)
  return ok(await q) as PlanoConta[]
}
/** colunas leves do cliente/fornecedor para listas e combos */
export const COLUNAS_PARCEIRO_LISTA = 'id, tipo, pessoa, nome, nome_fantasia, documento, email, telefone, cidade, uf, ativo'
export type ParceiroLista = Pick<Parceiro, 'id' | 'tipo' | 'pessoa' | 'nome' | 'nome_fantasia' | 'documento' | 'email' | 'telefone' | 'cidade' | 'uf' | 'ativo'>
export const listarParceiros = () =>
  todas<ParceiroLista>((de, ate) => supabase.from('parceiro').select(COLUNAS_PARCEIRO_LISTA).order('nome').order('id').range(de, ate))
