// Dados da empresa em uso que várias telas precisam sem buscar de novo: nome para impressões e cabeçalhos, CNPJ e a
// configuração da baixa (centros de custo de juros e descontos). Carregado pelo auth ao entrar na empresa.
import { useSyncExternalStore } from 'react'
import { supabase } from './supabase'
import type { Empresa } from './types'

let atual: Empresa | null = null
const ouvintes = new Set<() => void>()
const avisar = () => ouvintes.forEach((f) => f())

export async function carregarDadosEmpresa(id: number | null) {
  if (!id) { atual = null; avisar(); return }
  const { data } = await supabase.from('empresa').select('*').eq('id', id).maybeSingle()
  atual = (data as Empresa | null) ?? null
  avisar()
}

export function useDadosEmpresa(): Empresa | null {
  return useSyncExternalStore((f) => { ouvintes.add(f); return () => { ouvintes.delete(f) } }, () => atual)
}

/** nome para cabeçalhos de impressão ("Alfa — Contas a pagar") */
export const nomeDaEmpresa = (e: { razao_social: string; nome_fantasia: string | null } | null) => e?.nome_fantasia || e?.razao_social || ''
