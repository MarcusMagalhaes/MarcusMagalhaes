// Indicador global de "Carregando": conta as consultas em andamento e as telas esperando dados.
// O overlay (componente Ocupado, em ui.tsx) aparece enquanto houver alguma.

let ativos = 0
let texto: string | null = null
const ouvintes = new Set<() => void>()
const avisar = () => ouvintes.forEach((o) => o())

/** Marca o início de uma espera; devolve a função que marca o fim (pode ser chamada mais de uma vez) */
export function iniciarEspera(t?: string) {
  ativos++
  if (t) texto = t
  avisar()
  let feito = false
  return () => {
    if (feito) return
    feito = true
    ativos--
    if (!ativos) texto = null
    avisar()
  }
}

export const assinarEspera = (o: () => void) => { ouvintes.add(o); return () => { ouvintes.delete(o) } }
export const emEspera = () => ativos > 0
export const textoEspera = () => texto

const TEMPO_LIMITE_MS = 30_000

/**
 * fetch usado pelo cliente do Supabase: mostra o overlay nas leituras (GET/HEAD) e corta requisições sem resposta.
 * Fica de fora a renovação de sessão (/auth/v1, roda em segundo plano) e o envio de arquivos (pode demorar).
 */
export const fetchComEspera: typeof fetch = async (entrada, init) => {
  const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url
  const metodo = (init?.method ?? (entrada instanceof Request ? entrada.method : 'GET')).toUpperCase()
  const leitura = metodo === 'GET' || metodo === 'HEAD'
  const envioArquivo = url.includes('/storage/v1/object/') && !leitura
  const fim = leitura && !url.includes('/auth/v1/') ? iniciarEspera() : null

  const controle = new AbortController()
  const original = init?.signal
  if (original?.aborted) controle.abort(original.reason)
  else original?.addEventListener('abort', () => controle.abort(original.reason), { once: true })
  let esgotou = false
  const relogio = envioArquivo ? null : setTimeout(() => { esgotou = true; controle.abort() }, TEMPO_LIMITE_MS)
  try {
    return await fetch(entrada, { ...init, signal: controle.signal })
  } catch (e) {
    if (esgotou) {
      const erro = new Error('o servidor demorou mais de 30 segundos para responder. Verifique a internet e tente de novo.')
      erro.name = 'Sem resposta'
      throw erro
    }
    throw e
  } finally {
    if (relogio) clearTimeout(relogio)
    fim?.()
  }
}
