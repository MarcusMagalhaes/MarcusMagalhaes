// Leitura de extratos bancários no navegador: OFX (padrão dos bancos brasileiros, SGML ou XML) e CSV/TXT
// (data; descrição; valor — separador ; , ou tab; valor com vírgula ou ponto; débito negativo ou colunas separadas).
// Cada linha ganha extrato_id: FITID do OFX ou hash de data+valor+descrição (reimportar não duplica).

export interface LinhaExtrato { extrato_id: string; data: string; valor: number; descricao: string }

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return (h >>> 0).toString(16) }
const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

function lerValor(s: string): number | null {
  const t = s.replace(/[R$\s]/g, '').replace(/^\((.*)\)$/, '-$1')
  if (!t) return null
  const n = t.includes(',') ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t)
  return Number.isFinite(n) ? n : null
}
function lerData(s: string): string | null {
  const t = s.trim()
  let m = t.match(/^(\d{4})(\d{2})(\d{2})/)                      // OFX 20260930120000[-3:BRT]
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/)       // 30/09/2026
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` }
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/)                        // 2026-09-30
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return null
}

/** OFX: um <STMTTRN> por transação, com DTPOSTED, TRNAMT, FITID, MEMO/NAME */
export function lerOFX(texto: string): LinhaExtrato[] {
  const blocos = texto.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) ?? []
  const campo = (b: string, n: string) => { const m = b.match(new RegExp(`<${n}>([^<\\r\\n]*)`, 'i')); return m ? norm(m[1]) : '' }
  const out: LinhaExtrato[] = []
  for (const b of blocos) {
    const data = lerData(campo(b, 'DTPOSTED')); const valor = lerValor(campo(b, 'TRNAMT'))
    if (!data || valor === null) continue
    const descricao = norm([campo(b, 'NAME'), campo(b, 'MEMO')].filter(Boolean).join(' – ')) || campo(b, 'TRNTYPE')
    const fitid = campo(b, 'FITID')
    out.push({ extrato_id: fitid ? `ofx:${fitid}` : `h:${hash(`${data}|${valor}|${descricao}`)}`, data, valor, descricao })
  }
  return out
}

/** CSV/TXT: descobre separador e colunas (data, descrição, valor ou débito/crédito) pelo cabeçalho ou pelo conteúdo */
export function lerCSV(texto: string): LinhaExtrato[] {
  const linhas = texto.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (!linhas.length) return []
  const sep = [';', '\t', ','].map((s) => ({ s, n: (linhas[0].match(new RegExp(s === '\t' ? '\t' : `\\${s}`, 'g')) ?? []).length })).sort((a, b) => b.n - a.n)[0].s
  const partir = (l: string) => { const cols: string[] = []; let atual = '', aspas = false; for (const ch of l) { if (ch === '"') aspas = !aspas; else if (ch === sep && !aspas) { cols.push(atual); atual = '' } else atual += ch } cols.push(atual); return cols.map((c) => c.trim().replace(/^"|"$/g, '')) }
  const cab = partir(linhas[0]).map((c) => c.toLowerCase())
  const idx = (...nomes: string[]) => cab.findIndex((c) => nomes.some((n) => c.includes(n)))
  let iData = idx('data'), iDesc = idx('descri', 'histor', 'memo', 'lançamento', 'lancamento'), iValor = idx('valor', 'amount', 'montante'), iDeb = idx('débito', 'debito'), iCred = idx('crédito', 'credito')
  const temCab = iData >= 0 || iValor >= 0 || iDesc >= 0
  const corpo = temCab ? linhas.slice(1) : linhas
  if (!temCab) {
    // sem cabeçalho: data = primeira coluna com data; valor = última coluna numérica; descrição = a maior coluna de texto
    const ex = partir(corpo[0])
    iData = ex.findIndex((c) => lerData(c)); iValor = ex.length - 1 - [...ex].reverse().findIndex((c) => lerValor(c) !== null && !lerData(c))
    iDesc = ex.map((c, i) => ({ i, l: lerData(c) || lerValor(c) !== null ? -1 : c.length })).sort((a, b) => b.l - a.l)[0]?.i ?? -1
  }
  const out: LinhaExtrato[] = []
  for (const l of corpo) {
    const c = partir(l)
    const data = iData >= 0 ? lerData(c[iData] ?? '') : null
    let valor: number | null = null
    if (iValor >= 0) valor = lerValor(c[iValor] ?? '')
    else if (iDeb >= 0 || iCred >= 0) { const d = iDeb >= 0 ? lerValor(c[iDeb] ?? '') ?? 0 : 0, cr = iCred >= 0 ? lerValor(c[iCred] ?? '') ?? 0 : 0; valor = cr - Math.abs(d) }
    if (!data || valor === null || valor === 0) continue
    const descricao = norm(iDesc >= 0 ? c[iDesc] ?? '' : c.filter((x, i) => i !== iData && i !== iValor).join(' ')) || 'sem descrição'
    out.push({ extrato_id: `h:${hash(`${data}|${valor}|${descricao}`)}`, data, valor, descricao })
  }
  return out
}

/** transações idênticas no mesmo arquivo (dois PIX iguais no mesmo dia) ganham #2, #3…: sem isso a segunda seria
 *  tomada por duplicada. A ordem do arquivo se repete na reimportação, então os números também. */
export function desempatar(linhas: LinhaExtrato[]): LinhaExtrato[] {
  const vistos = new Map<string, number>()
  return linhas.map((l) => {
    const n = (vistos.get(l.extrato_id) ?? 0) + 1
    vistos.set(l.extrato_id, n)
    return n === 1 ? l : { ...l, extrato_id: `${l.extrato_id}#${n}` }
  })
}

export function lerExtrato(nome: string, texto: string): { formato: 'OFX' | 'CSV'; linhas: LinhaExtrato[] } {
  if (/\.ofx$/i.test(nome) || /<OFX>|<STMTTRN>/i.test(texto)) return { formato: 'OFX', linhas: desempatar(lerOFX(texto)) }
  return { formato: 'CSV', linhas: desempatar(lerCSV(texto)) }
}

/** Lê o arquivo respeitando a codificação (OFX de banco costuma vir em ISO-8859-1) */
export async function lerArquivoTexto(f: File): Promise<string> {
  const buf = await f.arrayBuffer()
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf)
  if (!utf8.includes('�')) return utf8
  return new TextDecoder('iso-8859-1').decode(buf)
}
