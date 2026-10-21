// Peças dos painéis e relatórios: indicador (KPI), seção, lista de barras horizontais e gráfico de barras mensal (SVG
// próprio, sem biblioteca: o pacote fica leve e a CSP não precisa liberar nada).
import type { ReactNode } from 'react'
import { Bloco } from './ui'

export function Indicador({ rotulo, valor, apoio, icone, tom = 'neutro' }:
  { rotulo: string; valor: ReactNode; apoio?: ReactNode; icone?: ReactNode; tom?: 'neutro' | 'entrada' | 'saida' | 'alerta' | 'destaque' }) {
  const borda = { neutro: 'border-l-grafite-700', entrada: 'border-l-emerald-600', saida: 'border-l-red-600', alerta: 'border-l-amber-500', destaque: 'border-l-laranja-500' }[tom]
  return (
    <div className={`card border-l-4 ${borda} px-3 py-2`}>
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">{icone}{rotulo}</div>
      <div className="mt-0.5 text-xl font-extrabold tabular-nums text-slate-900">{valor}</div>
      {apoio && <div className="text-[11px] text-slate-500">{apoio}</div>}
    </div>
  )
}

export function Secao({ titulo, acao, children, className = '', abertoInicial }: { titulo: ReactNode; acao?: ReactNode; children: ReactNode; className?: string; abertoInicial?: boolean }) {
  return (
    <Bloco titulo={titulo} acoes={acao} abertoInicial={abertoInicial} className={`p-3 ${className}`} classeCabecalho="mb-2" classeTitulo="text-xs font-extrabold uppercase tracking-wide text-grafite-900">
      {children}
    </Bloco>
  )
}

export type ItemBarra = { chave: string | number; rotulo: ReactNode; valor: number; texto: string; detalhe?: string; cor?: string }

export function ListaBarras({ itens, cor = '#34404c', vazio = 'Sem dados.' }: { itens: ItemBarra[]; cor?: string; vazio?: string }) {
  if (!itens.length) return <div className="py-4 text-center text-xs text-slate-400">{vazio}</div>
  const max = Math.max(...itens.map((i) => i.valor), 0) || 1
  return (
    <ul className="space-y-1">
      {itens.map((i) => (
        <li key={i.chave} className="group grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-2 rounded px-1 text-xs hover:bg-slate-50">
          <span className="truncate text-slate-700">{i.rotulo}</span>
          <span className="h-3 rounded-r bg-slate-100">
            <span className="block h-3 rounded-r transition-all group-hover:opacity-80" style={{ width: `${Math.max(2, (i.valor / max) * 100)}%`, background: i.cor ?? cor }} />
          </span>
          <span className="whitespace-nowrap text-right font-semibold tabular-nums text-slate-800">{i.texto}{i.detalhe && <span className="ml-1 font-normal text-slate-400">{i.detalhe}</span>}</span>
        </li>
      ))}
    </ul>
  )
}

export const COR_ENTRADA = '#059669'
export const COR_SAIDA = '#e65f03'
export const COR_SALDO = '#34404c'

/** barras lado a lado (entradas × saídas) por período, com linha opcional (saldo); valores em R$ */
export function GraficoBarras({ periodos, series, linha, altura = 180, fmt }: {
  periodos: string[]
  series: { nome: string; cor: string; valores: number[]; tracejada?: boolean }[]
  linha?: { nome: string; cor: string; valores: number[] }
  altura?: number
  fmt: (v: number) => string
}) {
  const n = periodos.length
  if (!n) return <div className="py-6 text-center text-xs text-slate-400">Sem dados no período.</div>
  const todos = [...series.flatMap((s) => s.valores), ...(linha?.valores ?? [])]
  const max = Math.max(0, ...todos), min = Math.min(0, ...todos)
  const faixa = max - min || 1
  const L = 640, A = altura, mx = 4, topo = 8, base = A - 18
  const y = (v: number) => topo + ((max - v) / faixa) * (base - topo)
  const larg = (L - 2 * mx) / n
  const barra = Math.max(2, Math.min(22, (larg - 6) / series.length))
  const pontos = linha?.valores.map((v, i) => `${mx + larg * i + larg / 2},${y(v)}`).join(' ')
  const passoRotulo = Math.ceil(n / 12)
  return (
    <div>
      <svg viewBox={`0 0 ${L} ${A}`} className="w-full" role="img" aria-label={series.map((s) => s.nome).join(' e ')}>
        <line x1={mx} x2={L - mx} y1={y(0)} y2={y(0)} stroke="#cbd5e1" strokeWidth="1" />
        {periodos.map((p, i) => (
          <g key={p}>
            {series.map((s, k) => {
              const v = s.valores[i] ?? 0
              const x = mx + larg * i + (larg - barra * series.length) / 2 + barra * k
              return <rect key={s.nome} x={x} y={Math.min(y(v), y(0))} width={barra - 1} height={Math.max(1, Math.abs(y(v) - y(0)))} fill={s.cor}
                opacity={s.tracejada ? 0.45 : 1} rx="1.5"><title>{`${p} · ${s.nome}: ${fmt(v)}`}</title></rect>
            })}
            {i % passoRotulo === 0 && <text x={mx + larg * i + larg / 2} y={A - 4} textAnchor="middle" fontSize="10" fill="#64748b">{p}</text>}
          </g>
        ))}
        {linha && <polyline points={pontos} fill="none" stroke={linha.cor} strokeWidth="2" />}
        {linha?.valores.map((v, i) => <circle key={i} cx={mx + larg * i + larg / 2} cy={y(v)} r="2.5" fill={linha.cor}><title>{`${periodos[i]} · ${linha.nome}: ${fmt(v)}`}</title></circle>)}
      </svg>
      <div className="mt-1 flex flex-wrap justify-center gap-3 text-[11px] text-slate-600">
        {series.map((s) => <span key={s.nome} className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.cor, opacity: s.tracejada ? 0.45 : 1 }} />{s.nome}</span>)}
        {linha && <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-3" style={{ background: linha.cor }} />{linha.nome}</span>}
      </div>
    </div>
  )
}
