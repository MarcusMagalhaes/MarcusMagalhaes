// Arquivos nos buckets privados do Supabase Storage: documentos anexados (nota fiscal, XML da NF-e, boleto, recibo,
// comprovante) e a logo da empresa. Todo arquivo vai para <empresa>/<pasta>/… e as políticas conferem a 1ª pasta (0005).
import { supabase } from './supabase'
import { normalizar } from './format'
import { abrirDoStorage } from './visualizador'

export type Bucket = 'documentos' | 'logos'

const LIMITE: Record<Bucket, number> = { documentos: 20 * 1024 * 1024, logos: 2 * 1024 * 1024 }
export const ACEITA: Record<Bucket, string> = {
  documentos: 'application/pdf,.pdf,image/jpeg,image/png,image/webp,.xml,application/xml,text/xml',
  // sem SVG: pode carregar script
  logos: 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp',
}
const REGRA: Record<Bucket, RegExp> = { documentos: /\.(pdf|jpe?g|png|webp|xml)$/i, logos: /\.(jpe?g|png|webp)$/i }
const DICA: Record<Bucket, string> = { documentos: 'PDF, imagem ou XML da nota até 20 MB', logos: 'PNG, JPG ou WEBP até 2 MB' }

export const fmtTamanho = (b: number | null | undefined) =>
  b == null ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`

/** Mensagem de erro se o arquivo não puder ser enviado; null se estiver ok */
export function validarArquivo(bucket: Bucket, f: File): string | null {
  if (f.size > LIMITE[bucket]) return `${f.name}: maior que ${fmtTamanho(LIMITE[bucket])}`
  if (!REGRA[bucket].test(f.name)) return `${f.name}: use ${DICA[bucket]}`
  return null
}
export const dicaArquivo = (bucket: Bucket) => DICA[bucket]

const nomeSeguro = (nome: string) => normalizar(nome).replace(/[^a-z0-9._-]+/g, '_').replace(/_+/g, '_').slice(-80) || 'arquivo'
const tipoMime = (f: File) => f.type
  || (/\.pdf$/i.test(f.name) ? 'application/pdf' : /\.xml$/i.test(f.name) ? 'application/xml' : 'application/octet-stream')

/** Fotos maiores que isso são reduzidas no navegador antes de enviar */
const REDUZIR_ACIMA = 800 * 1024
/** Reduz imagens JPEG/PNG/WEBP para no máximo `lado` px (JPEG 85%); se não conseguir abrir, envia a original */
export async function reduzirImagem(f: File, lado = 2000): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(f.type) || f.size <= REDUZIR_ACIMA) return f
  try {
    const img = await createImageBitmap(f)
    const escala = Math.min(1, lado / Math.max(img.width, img.height))
    const tela = document.createElement('canvas')
    tela.width = Math.round(img.width * escala); tela.height = Math.round(img.height * escala)
    tela.getContext('2d')!.drawImage(img, 0, 0, tela.width, tela.height)
    img.close()
    const blob = await new Promise<Blob | null>((r) => tela.toBlob(r, 'image/jpeg', 0.85))
    if (!blob || blob.size >= f.size) return f
    return new File([blob], f.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch { return f }
}

export interface ArquivoEnviado { caminho: string; nome: string; mime: string; tamanho: number }

// Empresa em uso: todo arquivo vai para <empresa_id>/<pasta>/…
let empresaAtual: number | null = null
export const definirEmpresaAtual = (id: number | null) => { empresaAtual = id }

/** Envia o arquivo para <bucket>/<empresa>/<pasta>/<carimbo>-<nome>; devolve os dados para gravar na tabela */
export async function enviarArquivo(bucket: Bucket, pasta: string, arquivo: File): Promise<ArquivoEnviado> {
  const f = await reduzirImagem(arquivo)
  const erro = validarArquivo(bucket, f)
  if (erro) throw new Error(erro)
  if (!empresaAtual) throw new Error('Nenhuma empresa selecionada')
  const caminho = `${empresaAtual}/${pasta}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${nomeSeguro(f.name)}`
  const mime = tipoMime(f)
  const up = await supabase.storage.from(bucket).upload(caminho, f, { contentType: mime, upsert: false })
  if (up.error) throw new Error(`${arquivo.name}: ${up.error.message}`)
  return { caminho, nome: arquivo.name, mime, tamanho: f.size }
}

export async function removerArquivo(bucket: Bucket, caminho: string | null | undefined) {
  if (!caminho) return
  const rm = await supabase.storage.from(bucket).remove([caminho])
  if (rm.error) throw new Error(rm.error.message)
}

/** Abre o arquivo no visualizador da tela (PDF e imagens; XML como texto) */
export const abrirArquivo = (bucket: Bucket, caminho: string, nome: string) => abrirDoStorage(bucket, caminho, nome)

/** JPEG, PNG ou WebP pela assinatura do arquivo; qualquer outra coisa → null */
function imagemPorBytes(b: Uint8Array): string | null {
  const ascii = (i: number, n: number) => String.fromCharCode(...b.slice(i, i + n))
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x89 && ascii(1, 3) === 'PNG') return 'image/png'
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp'
  return null
}
// Logos: baixa uma vez e guarda a URL local enquanto a página estiver aberta. Só imagem de verdade vira URL.
const imagens = new Map<string, Promise<string | null>>()
export function urlImagem(bucket: Bucket, caminho: string | null | undefined): Promise<string | null> {
  if (!caminho) return Promise.resolve(null)
  const chave = `${bucket}/${caminho}`
  let p = imagens.get(chave)
  if (!p) {
    p = supabase.storage.from(bucket).download(caminho).then(async ({ data }) => {
      if (!data) return null
      const mime = imagemPorBytes(new Uint8Array(await data.slice(0, 16).arrayBuffer()))
      return mime ? URL.createObjectURL(new Blob([data], { type: mime })) : null
    }).catch(() => null)
    imagens.set(chave, p)
  }
  return p
}
export const esquecerImagem = (bucket: Bucket, caminho: string | null | undefined) => { if (caminho) imagens.delete(`${bucket}/${caminho}`) }
