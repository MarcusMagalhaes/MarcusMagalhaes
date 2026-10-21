import { createClient } from '@supabase/supabase-js'
import { fetchComEspera } from './ocupado'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabaseConfigurado = Boolean(url && key)

export const supabase = createClient(url ?? 'https://placeholder.supabase.co', key ?? 'placeholder', {
  // PKCE: no login de reserva (signInWithOAuth) o retorno traz só um código (?code=), não o token na URL/histórico
  auth: { persistSession: true, autoRefreshToken: true, flowType: 'pkce' },
  global: { fetch: fetchComEspera },
})

/** Lança erro legível a partir de uma resposta do supabase-js */
export function ok<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(traduzirErro(res.error.message))
  return res.data as T
}

/** Mensagens do PostgREST/Postgres que o usuário entende */
export function traduzirErro(msg: string): string {
  if (/row-level security|permission denied/i.test(msg)) return 'Sem permissão para esta operação (verifique seu papel na empresa).'
  if (/duplicate key value/i.test(msg)) return 'Já existe um registro com esses dados (nome, código ou documento repetido).'
  if (/violates foreign key constraint.*titulo/i.test(msg)) return 'Este título tem baixas: estorne as baixas antes de excluir.'
  if (/violates foreign key constraint/i.test(msg)) return 'Este registro está em uso em outros lançamentos e não pode ser excluído: desative-o.'
  if (/JWT expired/i.test(msg)) return 'Sua sessão expirou. Recarregue a página e entre de novo.'
  return msg
}
