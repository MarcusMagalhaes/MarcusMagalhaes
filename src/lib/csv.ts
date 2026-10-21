// Exportação para planilha (CSV com ; e vírgula decimal, como o Excel em português abre direto) — relatórios e listas.
// Primeiro passo da comunicação com outros sistemas (contabilidade, BI): o arquivo sai do navegador, nada passa por servidor.

export type CelulaCsv = string | number | boolean | null | undefined

/** escapa uma célula: aspas em volta quando tem ; " ou quebra de linha; número com vírgula decimal */
export function celulaCsv(v: CelulaCsv): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 100) / 100).replace('.', ',') : ''
  if (typeof v === 'boolean') return v ? 'sim' : 'não'
  const s = String(v)
  // fórmula injetada (=, +, -, @) vira texto: a planilha não executa
  const seguro = /^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s) ? `'${s}` : s
  return /[;"\n\r]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro
}

export function gerarCsv(cabecalho: string[], linhas: CelulaCsv[][]): string {
  return [cabecalho, ...linhas].map((l) => l.map(celulaCsv).join(';')).join('\r\n')
}

/** baixa o CSV (com BOM: o Excel reconhece os acentos) */
export function baixarCsv(nomeArquivo: string, cabecalho: string[], linhas: CelulaCsv[][]) {
  const blob = new Blob(['﻿' + gerarCsv(cabecalho, linhas)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomeArquivo.endsWith('.csv') ? nomeArquivo : `${nomeArquivo}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
