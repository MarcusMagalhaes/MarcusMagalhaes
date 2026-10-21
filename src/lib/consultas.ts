// Consultas públicas usadas nos cadastros: CNPJ na BrasilAPI e CEP no ViaCEP (os dois estão liberados na CSP).
// Nada da empresa vai para essas APIs além do número consultado. O mapeamento é puro (testado em consultas.test.ts).
import { somenteDigitos } from './format'

export interface Endereco { cep: string | null; endereco: string | null; numero: string | null; complemento: string | null; bairro: string | null; cidade: string | null; uf: string | null }
export interface DadosCnpj extends Endereco { nome: string | null; nome_fantasia: string | null; telefone: string | null; email: string | null }

const txt = (v: unknown) => { const s = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''; return s ? s : null }
/** "RUA DAS FLORES" → "Rua das Flores" (as bases públicas vêm em maiúsculas) */
export function capitalizar(s: string | null): string | null {
  if (!s) return s
  const minusculas = new Set(['da', 'de', 'do', 'das', 'dos', 'e', 'em', 'a', 'o'])
  return s.toLowerCase().split(/\s+/).map((p, i) => (i > 0 && minusculas.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(' ')
}

/** resposta de https://brasilapi.com.br/api/cnpj/v1/<cnpj> → campos do cadastro */
export function mapearCnpj(j: Record<string, unknown>): DadosCnpj {
  const tipoLogradouro = txt(j.descricao_tipo_de_logradouro)
  const logradouro = txt(j.logradouro)
  const tel = somenteDigitos(txt(j.ddd_telefone_1) ?? '')
  return {
    nome: txt(j.razao_social),
    nome_fantasia: capitalizar(txt(j.nome_fantasia)),
    cep: somenteDigitos(txt(j.cep) ?? '') || null,
    endereco: capitalizar(logradouro ? (tipoLogradouro && !logradouro.toUpperCase().startsWith(tipoLogradouro.toUpperCase()) ? `${tipoLogradouro} ${logradouro}` : logradouro) : null),
    numero: txt(j.numero),
    complemento: capitalizar(txt(j.complemento)),
    bairro: capitalizar(txt(j.bairro)),
    cidade: capitalizar(txt(j.municipio)),
    uf: txt(j.uf)?.toUpperCase() ?? null,
    telefone: tel.length >= 10 ? tel : null,
    email: txt(j.email)?.toLowerCase() ?? null,
  }
}

/** resposta de https://viacep.com.br/ws/<cep>/json/ → endereço (null se o CEP não existe) */
export function mapearCep(j: Record<string, unknown>): Pick<Endereco, 'endereco' | 'bairro' | 'cidade' | 'uf'> | null {
  if (j.erro) return null
  return { endereco: txt(j.logradouro), bairro: txt(j.bairro), cidade: txt(j.localidade), uf: txt(j.uf)?.toUpperCase() ?? null }
}

/** copia para `alvo` só os campos que estão vazios nele (o que a pessoa digitou não é trocado) */
export function preencherVazios<T extends object>(alvo: T, novos: Partial<Record<keyof T, string | null>>): T {
  const r = { ...alvo } as Record<string, unknown>
  for (const [k, v] of Object.entries(novos)) {
    if (v != null && v !== '' && (r[k] == null || r[k] === '')) r[k] = v
  }
  return r as T
}

export async function buscarCnpj(cnpj: string): Promise<DadosCnpj> {
  const d = somenteDigitos(cnpj)
  if (d.length !== 14) throw new Error('Informe os 14 dígitos do CNPJ')
  let r: Response
  try { r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${d}`) } catch { throw new Error('Não foi possível consultar o CNPJ agora (sem internet ou serviço fora do ar)') }
  if (r.status === 404) throw new Error('CNPJ não encontrado na Receita Federal')
  if (!r.ok) throw new Error(`A consulta do CNPJ falhou (${r.status}). Tente de novo em instantes.`)
  return mapearCnpj(await r.json())
}

export async function buscarCep(cep: string) {
  const d = somenteDigitos(cep)
  if (d.length !== 8) throw new Error('Informe os 8 dígitos do CEP')
  let r: Response
  try { r = await fetch(`https://viacep.com.br/ws/${d}/json/`) } catch { throw new Error('Não foi possível consultar o CEP agora') }
  if (!r.ok) throw new Error('CEP inválido')
  const e = mapearCep(await r.json())
  if (!e) throw new Error('CEP não encontrado')
  return e
}
