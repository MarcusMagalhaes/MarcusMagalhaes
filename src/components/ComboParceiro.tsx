// Escolha de cliente/fornecedor com busca por nome, nome fantasia ou CPF/CNPJ (sem acento). `tipo` filtra a lista
// (contas a pagar: fornecedores; a receber: clientes); "AMBOS" aparece nas duas.
import { useEffect, useMemo, useRef, useState } from 'react'
import { normalizar, somenteDigitos } from '@/lib/format'
import { fmtDocumento } from '@/lib/documento'
import type { ParceiroLista } from '@/lib/dados'
import type { TipoParceiro } from '@/lib/types'

export default function ComboParceiro({ parceiros, valor, onChange, tipo, placeholder = 'digite o nome ou CNPJ…', autoFocus, className = 'input', onNovo }:
  { parceiros: ParceiroLista[]; valor: number | null; onChange: (id: number | null) => void; tipo?: Exclude<TipoParceiro, 'AMBOS'>
    placeholder?: string; autoFocus?: boolean; className?: string; onNovo?: (nome: string) => void }) {
  const [texto, setTexto] = useState('')
  const [aberto, setAberto] = useState(false)
  const [marcado, setMarcado] = useState(0)
  const caixa = useRef<HTMLDivElement>(null)
  const escolhido = useMemo(() => parceiros.find((p) => p.id === valor) ?? null, [parceiros, valor])
  const nomeDe = (p: ParceiroLista) => p.nome_fantasia || p.nome
  useEffect(() => { if (!aberto) setTexto(escolhido ? nomeDe(escolhido) : '') }, [escolhido, aberto])
  useEffect(() => {
    const h = (e: MouseEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  const lista = useMemo(() => {
    const t = normalizar(texto.trim())
    const dig = somenteDigitos(texto)
    return parceiros.filter((p) => (p.ativo || p.id === valor) && (!tipo || p.tipo === tipo || p.tipo === 'AMBOS')
      && (!t || normalizar(`${p.nome} ${p.nome_fantasia ?? ''}`).includes(t) || (dig.length >= 3 && (p.documento ?? '').includes(dig)))).slice(0, 30)
  }, [parceiros, texto, tipo, valor])
  const escolher = (p: ParceiroLista) => { onChange(p.id); setTexto(nomeDe(p)); setAberto(false) }
  return (
    <div ref={caixa} className="relative">
      <input className={className} value={texto} placeholder={placeholder} autoFocus={autoFocus}
        onFocus={() => { setAberto(true); setMarcado(0) }}
        onChange={(e) => { setTexto(e.target.value); setAberto(true); setMarcado(0); if (!e.target.value) onChange(null) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setMarcado((m) => Math.min(m + 1, lista.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setMarcado((m) => Math.max(m - 1, 0)) }
          else if (e.key === 'Enter' && aberto && lista[marcado]) { e.preventDefault(); escolher(lista[marcado]) }
          else if (e.key === 'Escape') setAberto(false)
        }} />
      {aberto && (lista.length > 0 || (onNovo && texto.trim())) && (
        <div className="absolute z-30 mt-0.5 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white text-xs shadow-lg">
          {lista.map((p, i) => (
            <button type="button" key={p.id} onMouseDown={(e) => e.preventDefault()} onClick={() => escolher(p)}
              className={`flex w-full items-center justify-between gap-2 px-2 py-1 text-left ${i === marcado ? 'bg-grafite-50' : 'hover:bg-slate-50'}`}>
              <span className="truncate">{nomeDe(p)}{p.nome_fantasia && <span className="ml-1 text-[10px] text-slate-400">{p.nome}</span>}</span>
              <span className="whitespace-nowrap text-[10px] text-slate-400">{fmtDocumento(p.documento)}</span>
            </button>
          ))}
          {onNovo && texto.trim() && !lista.some((p) => normalizar(nomeDe(p)) === normalizar(texto.trim())) && (
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setAberto(false); onNovo(texto.trim()) }}
              className="w-full border-t border-slate-100 px-2 py-1.5 text-left font-semibold text-laranja-700 hover:bg-laranja-50">+ Cadastrar "{texto.trim()}"</button>
          )}
        </div>
      )}
    </div>
  )
}
