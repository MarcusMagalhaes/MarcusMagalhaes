// Documentos de um lançamento ou título (0003, tabela anexo): nota fiscal, XML da NF-e, boleto, recibo, comprovante.
// Escolhidos do aparelho ou fotografados (no celular, `capture` abre a câmera). A ficha guarda o que foi escolhido e o
// que vai sair; o envio e a remoção acontecem ao salvar (`gravarAnexos`), porque o registro novo só tem id depois de
// gravado. Bucket `documentos`, pasta `<empresa>/lancamentos/<id>/…` ou `<empresa>/titulos/<id>/…` (0005).
import { useEffect, useMemo, useRef } from 'react'
import { supabase, ok } from '@/lib/supabase'
import { ACEITA, abrirArquivo, dicaArquivo, enviarArquivo, fmtTamanho, removerArquivo, validarArquivo } from '@/lib/arquivos'
import type { Anexo } from '@/lib/types'
import { useToast } from './ui'

export type DonoAnexo = { lancamento_id: number } | { titulo_id: number }
const pasta = (d: DonoAnexo) => ('lancamento_id' in d ? `lancamentos/${d.lancamento_id}` : `titulos/${d.titulo_id}`)

export const listarAnexos = async (d: DonoAnexo) => {
  const q = supabase.from('anexo').select('id, lancamento_id, titulo_id, caminho, nome, mime, tamanho, criado_em').order('id')
  return ok(await ('lancamento_id' in d ? q.eq('lancamento_id', d.lancamento_id) : q.eq('titulo_id', d.titulo_id))) as Anexo[]
}

/** envia os novos e apaga os marcados para sair; devolve os erros (o registro já está salvo) */
export async function gravarAnexos(d: DonoAnexo, novos: File[], sair: Anexo[]): Promise<string[]> {
  const erros: string[] = []
  for (const f of novos) {
    try {
      const e = await enviarArquivo('documentos', pasta(d), f)
      try {
        ok(await supabase.from('anexo').insert({ ...d, caminho: e.caminho, nome: f.name, mime: e.mime, tamanho: e.tamanho }))
      } catch (x) { await removerArquivo('documentos', e.caminho).catch(() => {}); throw x }
    } catch (x: any) { erros.push(`${f.name}: ${x.message}`) }
  }
  for (const a of sair) {
    try {
      ok(await supabase.from('anexo').delete().eq('id', a.id))
      await removerArquivo('documentos', a.caminho)
    } catch (x: any) { erros.push(`${a.nome}: ${x.message}`) }
  }
  return erros
}

/** depois de excluir o registro (as linhas dos anexos saem em cascata), apaga os arquivos do Storage */
export async function apagarArquivos(anexos: Anexo[]) {
  for (const a of anexos) await removerArquivo('documentos', a.caminho).catch(() => {})
}

const ehImagem = (nome: string, mime?: string | null) => /^image\//.test(mime ?? '') || /\.(jpe?g|png|webp)$/i.test(nome)
const carimbo = () => { const d = new Date(), p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}` }

export default function Anexos({ atuais, sair, novos, onNovos, onSair, somenteLeitura }: {
  atuais: Anexo[]; sair: Set<number>; novos: File[]
  onNovos: (f: File[]) => void; onSair: (s: Set<number>) => void; somenteLeitura?: boolean
}) {
  const { toast } = useToast()
  const arquivo = useRef<HTMLInputElement>(null)
  const camera = useRef<HTMLInputElement>(null)
  const previas = useMemo(() => novos.map((f) => (ehImagem(f.name, f.type) ? URL.createObjectURL(f) : null)), [novos])
  useEffect(() => () => previas.forEach((u) => u && URL.revokeObjectURL(u)), [previas])

  function escolher(lista: FileList | null, foto = false) {
    const aceitos: File[] = []
    for (const f0 of Array.from(lista ?? [])) {
      // a câmera do celular manda tudo como "image.jpg": dá um nome com data e hora
      const f = foto ? new File([f0], `foto-${carimbo()}${aceitos.length ? `-${aceitos.length + 1}` : ''}.jpg`, { type: f0.type || 'image/jpeg' }) : f0
      // imagem grande é reduzida no envio: aqui só o tipo
      const erro = ehImagem(f.name, f.type) ? (/\.(jpe?g|png|webp)$/i.test(f.name) ? null : `${f.name}: use ${dicaArquivo('documentos')}`) : validarArquivo('documentos', f)
      if (erro) toast(erro, 'erro'); else aceitos.push(f)
    }
    if (aceitos.length) onNovos([...novos, ...aceitos])
    if (arquivo.current) arquivo.current.value = ''
    if (camera.current) camera.current.value = ''
  }
  const alternar = (id: number) => { const s = new Set(sair); if (s.has(id)) s.delete(id); else s.add(id); onSair(s) }
  const total = atuais.length - sair.size + novos.length

  return (
    <div className="min-w-0 rounded-lg border border-slate-200 p-2">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="label mb-0">Documentos{total > 0 ? ` (${total})` : ''}</span>
        {!somenteLeitura && (
          <div className="flex items-center gap-1.5">
            <button type="button" className="btn-secondary py-1 text-xs" onClick={() => arquivo.current?.click()}>📎 Anexar</button>
            <button type="button" className="btn-secondary py-1 text-xs sm:hidden" onClick={() => camera.current?.click()}>📷 Fotografar</button>
            <input ref={arquivo} type="file" multiple accept={ACEITA.documentos} className="hidden" onChange={(e) => escolher(e.target.files)} />
            <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => escolher(e.target.files, true)} />
          </div>
        )}
      </div>
      {atuais.length === 0 && novos.length === 0 && <div className="text-xs text-slate-400">Nenhum documento. Nota fiscal, boleto ou comprovante: {dicaArquivo('documentos')}.</div>}
      <ul className="flex flex-col gap-1">
        {atuais.map((a) => (
          <li key={a.id} className={`flex items-center gap-2 text-xs ${sair.has(a.id) ? 'opacity-50' : ''}`}>
            <span>{ehImagem(a.nome, a.mime) ? '🖼️' : /\.xml$/i.test(a.nome) ? '🧾' : '📄'}</span>
            <button type="button" className={`min-w-0 flex-1 truncate text-left font-semibold text-grafite-900 ${sair.has(a.id) ? 'line-through' : 'underline'}`} title="Abrir"
              onClick={() => abrirArquivo('documentos', a.caminho, a.nome).catch((e) => toast(e.message, 'erro'))}>{a.nome}</button>
            <span className="whitespace-nowrap text-slate-400">{sair.has(a.id) ? 'sai ao salvar' : fmtTamanho(a.tamanho)}</span>
            {!somenteLeitura && <button type="button" className={`px-1 ${sair.has(a.id) ? 'text-slate-600' : 'text-red-600'}`} title={sair.has(a.id) ? 'Manter' : 'Remover ao salvar'} onClick={() => alternar(a.id)}>{sair.has(a.id) ? '↺' : '✕'}</button>}
          </li>
        ))}
        {novos.map((f, i) => (
          <li key={`n${i}`} className="flex items-center gap-2 text-xs">
            {previas[i] ? <img src={previas[i]!} alt="" className="h-8 w-8 rounded object-cover" /> : <span>📄</span>}
            <span className="min-w-0 flex-1 truncate font-semibold">{f.name}</span>
            <span className="whitespace-nowrap text-slate-400">{fmtTamanho(f.size)} · envia ao salvar</span>
            <button type="button" className="px-1 text-red-600" title="Tirar" onClick={() => onNovos(novos.filter((_, k) => k !== i))}>✕</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
