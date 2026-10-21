// Visualizador de arquivos (notas, boletos, comprovantes) numa modal da própria tela, em vez de aba nova.
// O arquivo é baixado e mostrado por link local (blob:), com o tipo conferido pelos primeiros bytes.
import { supabase } from './supabase'

export type TipoVisto = 'imagem' | 'pdf' | 'texto' | 'outro'
export type ArquivoVisto = { url: string; nome: string; tipo: TipoVisto }

let atual: ArquivoVisto | null = null
const ouvintes = new Set<() => void>()
const avisar = () => ouvintes.forEach((f) => f())

export const assinarVisualizador = (f: () => void) => { ouvintes.add(f); return () => { ouvintes.delete(f) } }
export const arquivoVisto = () => atual
export function fecharVisualizador() {
  if (atual) URL.revokeObjectURL(atual.url)
  atual = null; avisar()
}

/** Tipo pelo conteúdo (assinatura do arquivo); se não reconhecer, pelo nome */
async function descobrirTipo(b: Blob, nome: string): Promise<{ tipo: TipoVisto; mime: string }> {
  const c = new Uint8Array(await b.slice(0, 64).arrayBuffer())
  const ini = (...bs: number[]) => bs.every((v, i) => c[i] === v)
  const txt = String.fromCharCode(...c)
  if (txt.startsWith('%PDF')) return { tipo: 'pdf', mime: 'application/pdf' }
  if (ini(0xff, 0xd8, 0xff)) return { tipo: 'imagem', mime: 'image/jpeg' }
  if (ini(0x89, 0x50, 0x4e, 0x47)) return { tipo: 'imagem', mime: 'image/png' }
  if (txt.startsWith('RIFF') && txt.slice(8, 12) === 'WEBP') return { tipo: 'imagem', mime: 'image/webp' }
  const n = nome.toLowerCase()
  // XML da NF-e, HTML e SVG viram texto puro: nunca rodam script na origem do site
  if (/^(ï»¿|ÿþ|þÿ|\0|\s)*</.test(txt) || n.endsWith('.xml') || n.endsWith('.svg') || n.endsWith('.htm') || n.endsWith('.html'))
    return { tipo: 'texto', mime: 'text/plain;charset=utf-8' }
  return { tipo: 'outro', mime: 'application/octet-stream' }
}

/** Baixa o arquivo do bucket privado e abre no visualizador */
export async function abrirDoStorage(bucket: string, caminho: string, nome: string) {
  const { data, error } = await supabase.storage.from(bucket).download(caminho)
  if (error || !data) throw new Error(error?.message ?? 'Não foi possível abrir o arquivo')
  const { tipo, mime } = await descobrirTipo(data, nome)
  if (atual) URL.revokeObjectURL(atual.url)
  atual = { url: URL.createObjectURL(new Blob([data], { type: mime })), nome, tipo }
  avisar()
}
