// Lançamento por modelo (0007, trazido do Luminexus 0121): a tela Lançamentos vira um quadro de blocos montado pelo
// financeiro, no desenho da planilha do mês (ENTRADAS - VENDAS, SAÍDAS FIXAS…). Cada linha é um centro de custo com o
// total do mês e o "+" que abre o lançamento com a data e o centro já preenchidos (o centro define entrada ou saída).
// O centro escolhido no modelo entra com todos os filhos (filho criado depois aparece sozinho). Usado só por
// Lancamentos.tsx, que abre a ficha.
import { useMemo, useState } from 'react'
import { supabase, ok } from '@/lib/supabase'
import { contemCodigo } from '@/lib/planoContas'
import { fmtData, fmtMoeda, fmtValor } from '@/lib/format'
import { escHtml } from '@/lib/imprimir'
import type { BlocoModelo, CorBloco, Lancamento, ModeloLancamento, PlanoConta } from '@/lib/types'
import { Campo, Chip, Confirmar, Modal, useToast, Vazio } from '@/components/ui'

export const CORES_BLOCO: Record<CorBloco, { nome: string; topo: string; rodape: string; borda: string; amostra: string; hex: string; hexClaro: string }> = {
  verde: { nome: 'Verde', topo: 'bg-emerald-200 text-emerald-950', rodape: 'bg-emerald-50', borda: 'border-emerald-300', amostra: 'bg-emerald-300', hex: '#a7f3d0', hexClaro: '#ecfdf5' },
  laranja: { nome: 'Laranja', topo: 'bg-orange-200 text-orange-950', rodape: 'bg-orange-50', borda: 'border-orange-300', amostra: 'bg-orange-300', hex: '#fed7aa', hexClaro: '#fff7ed' },
  azul: { nome: 'Azul', topo: 'bg-sky-200 text-sky-950', rodape: 'bg-sky-50', borda: 'border-sky-300', amostra: 'bg-sky-300', hex: '#bae6fd', hexClaro: '#f0f9ff' },
  vermelho: { nome: 'Vermelho', topo: 'bg-red-200 text-red-950', rodape: 'bg-red-50', borda: 'border-red-300', amostra: 'bg-red-300', hex: '#fecaca', hexClaro: '#fef2f2' },
  amarelo: { nome: 'Amarelo', topo: 'bg-amber-200 text-amber-950', rodape: 'bg-amber-50', borda: 'border-amber-300', amostra: 'bg-amber-300', hex: '#fde68a', hexClaro: '#fffbeb' },
  roxo: { nome: 'Roxo', topo: 'bg-violet-200 text-violet-950', rodape: 'bg-violet-50', borda: 'border-violet-300', amostra: 'bg-violet-300', hex: '#ddd6fe', hexClaro: '#f5f3ff' },
  cinza: { nome: 'Cinza', topo: 'bg-slate-200 text-slate-900', rodape: 'bg-slate-50', borda: 'border-slate-300', amostra: 'bg-slate-300', hex: '#e2e8f0', hexClaro: '#f8fafc' },
}

export interface LinhaBloco { c: PlanoConta; recuo: number; temFilhos: boolean }
/** linhas do bloco: cada centro escolhido com todos os descendentes que recebem lançamento (2º nível para baixo), sem repetir */
export function linhasDoBloco(b: BlocoModelo, planos: PlanoConta[]): LinhaBloco[] {
  const ordem = [...planos].sort((x, y) => x.codigo - y.codigo)
  const vistos = new Set<number>()
  const linhas: LinhaBloco[] = []
  for (const id of b.centros) {
    const c = ordem.find((x) => x.id === id)
    if (!c) continue
    const sub = ordem.filter((x) => x.nivel > 1 && contemCodigo(c, x.codigo) && !vistos.has(x.id))
    const base = Math.min(...sub.map((x) => x.nivel))
    for (const x of sub) { vistos.add(x.id); linhas.push({ c: x, recuo: x.nivel - base, temFilhos: sub.some((y) => y.pai_id === x.id) }) }
  }
  return linhas
}

/** total confirmado por centro de custo (pendentes do extrato ficam fora, como nos totais da lista) */
function totaisPorCentro(lista: Lancamento[]) {
  const m = new Map<number, number>()
  for (const l of lista) if (l.plano_conta_id && l.situacao === 'CONFIRMADO') m.set(l.plano_conta_id, (m.get(l.plano_conta_id) ?? 0) + Number(l.valor))
  return m
}

interface BlocoCalculado { b: BlocoModelo; linhas: (LinhaBloco & { valor: number })[]; total: number; pendentes: number }
function calcular(modelo: ModeloLancamento, planos: PlanoConta[], lista: Lancamento[]): BlocoCalculado[] {
  const tot = totaisPorCentro(lista)
  const sub = (c: PlanoConta) => planos.reduce((s, x) => s + (contemCodigo(c, x.codigo) ? tot.get(x.id) ?? 0 : 0), 0)
  return modelo.blocos.map((b) => {
    const todas = linhasDoBloco(b, planos)
    const ids = new Set(todas.map((x) => x.c.id))
    const linhas = todas.map((x) => ({ ...x, valor: x.temFilhos ? sub(x.c) : tot.get(x.c.id) ?? 0 }))
      .filter((x) => x.c.ativa || x.valor !== 0)       // centro inativo só aparece se teve lançamento no mês
    return {
      b, linhas,
      total: todas.reduce((s, x) => s + (tot.get(x.c.id) ?? 0), 0),
      pendentes: lista.filter((l) => l.situacao === 'PENDENTE' && l.plano_conta_id != null && ids.has(l.plano_conta_id)).length,
    }
  })
}

export function QuadroModelo({ modelo, planos, lista, podeLancar, onNovo, onVer }: {
  modelo: ModeloLancamento; planos: PlanoConta[]; lista: Lancamento[]; podeLancar: boolean
  onNovo: (c: PlanoConta) => void; onVer: (c: PlanoConta) => void
}) {
  const blocos = useMemo(() => calcular(modelo, planos, lista), [modelo, planos, lista])
  if (blocos.length === 0) return <Vazio texto="Modelo sem blocos: clique em ✏️ Editar modelo" />
  return (
    <div className="grid items-start gap-2 [grid-template-columns:repeat(auto-fill,minmax(270px,1fr))]">
      {blocos.map(({ b, linhas, total, pendentes }, i) => {
        const cor = CORES_BLOCO[b.cor] ?? CORES_BLOCO.cinza
        return (
          <div key={i} className={`overflow-hidden rounded-lg border bg-white shadow-sm ${cor.borda}`}>
            <div className={`px-2 py-1 text-center text-[11px] font-bold uppercase tracking-wide ${cor.topo}`}>{b.titulo}</div>
            <table className="w-full text-[12px]">
              <tbody>
                {linhas.length === 0 && <tr><td className="px-2 py-1 text-slate-400" colSpan={3}>Nenhum centro de custo ativo</td></tr>}
                {linhas.map(({ c, recuo, temFilhos, valor }) => (
                  <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="py-0.5 pr-1" style={{ paddingLeft: 8 + recuo * 12 }}>
                      <span className={c.tipo === 'ENTRADA' ? 'mr-1 text-[9px] text-emerald-700' : 'mr-1 text-[9px] text-red-700'}>{c.tipo === 'ENTRADA' ? '▲' : '▼'}</span>
                      <span className={temFilhos ? 'font-semibold' : ''}>{c.nome}</span>
                      {!c.ativa && <span className="ml-1 text-[10px] text-slate-400">(inativo)</span>}
                    </td>
                    <td className="whitespace-nowrap py-0.5 text-right tabular-nums">
                      {valor !== 0
                        ? <button className={`hover:underline ${temFilhos ? 'font-semibold text-slate-500' : 'font-semibold'}`} title={`Ver os lançamentos de ${c.nome}`} onClick={() => onVer(c)}>{fmtValor(valor)}</button>
                        : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="w-8 py-0.5 text-center">
                      {podeLancar && c.ativa && <button className="h-5 w-5 rounded-full bg-grafite-900 text-[13px] font-bold leading-5 text-white hover:bg-laranja-500" title={`Lançar em ${c.nome}`} onClick={() => onNovo(c)}>+</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className={`border-t font-bold ${cor.rodape} ${cor.borda}`}>
                  <td className="py-1 pl-2 text-[11px] uppercase">Total</td>
                  <td className="whitespace-nowrap py-1 text-right tabular-nums">{fmtMoeda(total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
            {pendentes > 0 && <div className="px-2 pb-1 text-[10px] text-amber-700">{pendentes} pendente(s) de conciliação fora do total</div>}
          </div>
        )
      })}
    </div>
  )
}

/** lançamentos do mês de um centro (com os filhos), para abrir, corrigir ou excluir */
export function LancamentosDoCentro({ centro, lista, podeLancar, onAbrir, onNovo, onFechar }: {
  centro: PlanoConta; lista: Lancamento[]; podeLancar: boolean; onAbrir: (l: Lancamento) => void; onNovo: () => void; onFechar: () => void
}) {
  const itens = lista.filter((l) => l.plano_codigo != null && contemCodigo(centro, l.plano_codigo))
  const total = itens.filter((l) => l.situacao === 'CONFIRMADO').reduce((s, l) => s + Number(l.valor), 0)
  return (
    <Modal aberto titulo={`${centro.nome} · ${fmtMoeda(total)}`} onFechar={onFechar} largura="max-w-2xl">
      {itens.length === 0 ? <Vazio texto="Nenhum lançamento no mês" /> : (
        <div className="max-h-[60vh] overflow-auto">
          <table className="tabela">
            <thead><tr><th>Data</th><th>Centro de custo</th><th>Cliente/fornecedor</th><th>Conta</th><th>Descrição</th><th className="num">Valor</th></tr></thead>
            <tbody>
              {itens.map((l) => (
                <tr key={l.id} className="cursor-pointer hover:bg-grafite-50" onClick={() => onAbrir(l)}>
                  <td className="whitespace-nowrap">{fmtData(l.data)}</td><td>{l.plano}</td><td>{l.parceiro}</td><td>{l.conta}</td>
                  <td className="max-w-[220px] truncate">{l.situacao === 'PENDENTE' && <Chip cor="amarelo">pendente</Chip>} {l.descricao}</td>
                  <td className="num font-semibold">{fmtValor(l.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <button className="btn-secondary" onClick={onFechar}>Fechar</button>
        {podeLancar && centro.ativa && <button className="btn-primary" onClick={onNovo}>+ Lançar em {centro.nome}</button>}
      </div>
    </Modal>
  )
}

/** corpo da impressão do quadro (o cabeçalho vem de cabecalhoImpressao, na tela) */
export function htmlModelo(modelo: ModeloLancamento, planos: PlanoConta[], lista: Lancamento[]) {
  return calcular(modelo, planos, lista).map(({ b, linhas, total }) => {
    const cor = CORES_BLOCO[b.cor] ?? CORES_BLOCO.cinza
    const corpo = linhas.map(({ c, recuo, temFilhos, valor }) => `<tr><td style="padding-left:${4 + recuo * 10}px${temFilhos ? ';font-weight:600' : ''}">${escHtml(c.nome)}</td><td class="num">${valor ? fmtValor(valor) : ''}</td></tr>`).join('')
    return `<div style="display:inline-block;vertical-align:top;width:32%;margin:0 0.5% 8px;border:1px solid #334155;break-inside:avoid">
      <div style="background:${cor.hex};text-align:center;font-weight:700;font-size:8pt;padding:2px;text-transform:uppercase">${escHtml(b.titulo)}</div>
      <table><tbody>${corpo}</tbody><tfoot><tr style="background:${cor.hexClaro};font-weight:700"><td>TOTAL</td><td class="num">${fmtMoeda(total)}</td></tr></tfoot></table></div>`
  }).join('')
}

const NOVO_BLOCO = (): BlocoModelo => ({ titulo: '', cor: 'verde', centros: [] })
const mover = <T,>(arr: T[], i: number, d: number) => {
  const j = i + d
  if (j < 0 || j >= arr.length) return arr
  const n = [...arr]; [n[i], n[j]] = [n[j], n[i]]; return n
}

/** cria, altera ou exclui um modelo; devolve o id salvo (null = excluído, undefined = cancelado) */
export function EditorModelo({ inicial, planos, onFechar }: {
  inicial: Partial<ModeloLancamento>; planos: PlanoConta[]; onFechar: (id?: number | null) => void
}) {
  const { toast } = useToast()
  const [nome, setNome] = useState(inicial.nome ?? '')
  const [blocos, setBlocos] = useState<BlocoModelo[]>(inicial.blocos?.length ? inicial.blocos : [NOVO_BLOCO()])
  const [excluir, setExcluir] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const ordem = useMemo(() => [...planos].sort((a, b) => a.codigo - b.codigo), [planos])
  const porId = useMemo(() => new Map(planos.map((c) => [c.id, c])), [planos])
  const raizes = ordem.filter((c) => c.nivel === 1 && c.ativa)

  const alterar = (i: number, b: Partial<BlocoModelo>) => setBlocos((bs) => bs.map((x, k) => (k === i ? { ...x, ...b } : x)))
  function incluirCentro(i: number, id: number) {
    const c = porId.get(id)
    if (!c) return
    // o centro novo cobre os filhos que já estavam no bloco: eles saem
    alterar(i, { centros: [...blocos[i].centros.filter((x) => { const y = porId.get(x); return !y || !contemCodigo(c, y.codigo) }), id] })
  }
  /** já está no bloco, ele ou um ancestral */
  const coberto = (b: BlocoModelo, c: PlanoConta) => b.centros.some((x) => { const y = porId.get(x); return !!y && contemCodigo(y, c.codigo) })
  const qtdFilhos = (c: PlanoConta) => ordem.filter((x) => x.id !== c.id && x.ativa && contemCodigo(c, x.codigo)).length

  function sugerir() {
    setBlocos(raizes.map((r) => ({ titulo: `${r.tipo === 'ENTRADA' ? 'Entradas' : 'Saídas'} - ${r.nome}`, cor: r.tipo === 'ENTRADA' ? 'verde' : 'laranja', centros: [r.id] })))
  }

  async function salvar() {
    if (salvando) return
    if (!nome.trim()) { toast('Informe o nome do modelo', 'erro'); return }
    if (blocos.length === 0) { toast('Inclua pelo menos um bloco', 'erro'); return }
    const i = blocos.findIndex((b) => !b.titulo.trim() || b.centros.length === 0)
    if (i >= 0) { toast(`Bloco ${i + 1}: informe o título e pelo menos um centro de custo`, 'erro'); return }
    const dados = { nome: nome.trim(), blocos: blocos.map((b) => ({ ...b, titulo: b.titulo.trim() })) }
    setSalvando(true)
    try {
      const r = ok<{ id: number }>(inicial.id
        ? await supabase.from('modelo_lancamento').update(dados).eq('id', inicial.id).select('id').single()
        : await supabase.from('modelo_lancamento').insert(dados).select('id').single())
      toast('Modelo salvo'); onFechar(r.id)
    } catch (e: any) {
      toast(/ux_modelo_lancamento_nome|duplicate/.test(e.message) ? 'Já existe um modelo com esse nome' : e.message, 'erro')
      setSalvando(false)
    }
  }
  async function apagar() {
    setExcluir(false)
    try { ok(await supabase.from('modelo_lancamento').delete().eq('id', inicial.id!)); toast('Modelo excluído'); onFechar(null) } catch (e: any) { toast(e.message, 'erro') }
  }

  return (
    <Modal aberto titulo={inicial.id ? `Modelo: ${inicial.nome}` : 'Novo modelo de lançamento'} onFechar={() => onFechar()} largura="max-w-5xl">
      <div className="ficha flex flex-col gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <Campo label="Nome do modelo" className="min-w-[220px] flex-1"><input className="input" value={nome} autoFocus={!inicial.id} onChange={(e) => setNome(e.target.value)} placeholder="ex.: Controle mensal" /></Campo>
          <button className="btn-secondary" title="Troca os blocos por um bloco para cada centro de custo do 1º nível" onClick={sugerir}>✨ Um bloco por centro pai</button>
        </div>
        <p className="text-[11px] text-slate-500">
          Cada bloco vira um quadro na tela de lançamento, na ordem abaixo. O centro de custo escolhido entra com todos os filhos
          (os criados depois também); para só alguns filhos, escolha os filhos um a um.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {blocos.map((b, i) => {
            const cor = CORES_BLOCO[b.cor] ?? CORES_BLOCO.cinza
            return (
              <div key={i} className={`overflow-hidden rounded-lg border bg-white ${cor.borda}`}>
                <div className={`flex items-center gap-1 px-2 py-1 ${cor.topo}`}>
                  <span className="text-[11px] font-bold">{i + 1}.</span>
                  <input className="input flex-1 py-0.5 text-xs font-semibold" value={b.titulo} placeholder="Título do bloco (ex.: SAÍDAS FIXAS)" onChange={(e) => alterar(i, { titulo: e.target.value })} />
                  <button className="btn-secondary px-1.5 py-0.5" title="Mover para antes" disabled={i === 0} onClick={() => setBlocos(mover(blocos, i, -1))}>↑</button>
                  <button className="btn-secondary px-1.5 py-0.5" title="Mover para depois" disabled={i === blocos.length - 1} onClick={() => setBlocos(mover(blocos, i, 1))}>↓</button>
                  <button className="btn-secondary px-1.5 py-0.5 text-red-700" title="Remover o bloco" onClick={() => setBlocos(blocos.filter((_, k) => k !== i))}>✕</button>
                </div>
                <div className="flex flex-col gap-1 p-2">
                  <div className="flex items-center gap-1">
                    <span className="label mb-0 mr-1">Cor</span>
                    {(Object.keys(CORES_BLOCO) as CorBloco[]).map((k) => (
                      <button key={k} type="button" title={CORES_BLOCO[k].nome} onClick={() => alterar(i, { cor: k })}
                        className={`h-5 w-5 rounded-full ${CORES_BLOCO[k].amostra} ${b.cor === k ? 'ring-2 ring-grafite-900 ring-offset-1' : ''}`} />
                    ))}
                  </div>
                  {b.centros.length === 0 && <div className="text-[11px] text-slate-400">Nenhum centro de custo ainda.</div>}
                  {b.centros.map((id, k) => {
                    const c = porId.get(id)
                    const raiz = c && c.nivel > 1 ? ordem.find((x) => x.nivel === 1 && contemCodigo(x, c.codigo)) : null
                    const n = c ? qtdFilhos(c) : 0
                    return (
                      <div key={id} className="flex items-center gap-1 rounded border border-slate-200 px-1.5 py-0.5 text-xs">
                        <span className={c?.tipo === 'ENTRADA' ? 'text-emerald-700' : 'text-red-700'}>{c?.tipo === 'ENTRADA' ? '▲' : '▼'}</span>
                        <span className="flex-1 truncate">
                          {c ? c.nome : <i className="text-slate-400">centro removido</i>}
                          {raiz && <span className="ml-1 text-[10px] text-slate-400">{raiz.nome}</span>}
                          {n > 0 && <span className="ml-1 text-[10px] text-slate-500">+ {n} filho{n > 1 ? 's' : ''}</span>}
                          {c && !c.ativa && <span className="ml-1 text-[10px] text-slate-400">(inativo)</span>}
                        </span>
                        <button className="px-1 text-slate-500 disabled:opacity-30" disabled={k === 0} onClick={() => alterar(i, { centros: mover(b.centros, k, -1) })}>↑</button>
                        <button className="px-1 text-slate-500 disabled:opacity-30" disabled={k === b.centros.length - 1} onClick={() => alterar(i, { centros: mover(b.centros, k, 1) })}>↓</button>
                        <button className="px-1 text-red-600" title="Tirar do bloco" onClick={() => alterar(i, { centros: b.centros.filter((x) => x !== id) })}>✕</button>
                      </div>
                    )
                  })}
                  <select className="input text-xs" value="" onChange={(e) => e.target.value && incluirCentro(i, Number(e.target.value))}>
                    <option value="">+ incluir centro de custo…</option>
                    {raizes.map((r) => (
                      <optgroup key={r.id} label={`${r.tipo === 'ENTRADA' ? '▲ Entrada' : '▼ Saída'} · ${r.nome}`}>
                        {ordem.filter((c) => c.ativa && contemCodigo(r, c.codigo)).map((c) => (
                          <option key={c.id} value={c.id} disabled={coberto(b, c)}>
                            {'   '.repeat(c.nivel - 1)}{c.nivel === 1 ? `${c.nome} (todos)` : c.nome}{coberto(b, c) ? ' ✓' : ''}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
              </div>
            )
          })}
          <button className="min-h-[90px] rounded-lg border-2 border-dashed border-slate-300 text-sm font-semibold text-slate-500 hover:border-laranja-500 hover:text-grafite-900" onClick={() => setBlocos([...blocos, NOVO_BLOCO()])}>＋ Bloco</button>
        </div>
        <div className="acoes flex items-center justify-between gap-2 pt-1">
          <div>{inicial.id && <button className="btn-danger" onClick={() => setExcluir(true)}>Excluir modelo</button>}</div>
          <div className="flex gap-2"><button className="btn-secondary" onClick={() => onFechar()}>Cancelar</button><button className="btn-primary" disabled={salvando} onClick={salvar}>Salvar modelo</button></div>
        </div>
      </div>
      <Confirmar aberto={excluir} perigo titulo="Excluir modelo" texto={`Excluir o modelo "${inicial.nome}"? Os lançamentos não mudam.`} onNao={() => setExcluir(false)} onSim={apagar} />
    </Modal>
  )
}
