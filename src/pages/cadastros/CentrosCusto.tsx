// Centros de custo (0002/0007, como no Luminexus 0082/0083; tabela interna plano_conta): árvore de até 4 níveis com
// código de 8 dígitos gerado pelo banco. O 1º nível define se é entrada ou saída e a linha da DRE, herdados pelos filhos;
// lançamentos, títulos e orçamento vão do 2º nível para baixo. Só o financeiro completo inclui e altera.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase, ok } from '@/lib/supabase'
import { listarPlano } from '@/lib/dados'
import { useAuth } from '@/lib/auth'
import { MAX_FILHOS, NIVEL_MAX, NOME_NIVEL, fmtCodigoPlano } from '@/lib/planoContas'
import { baixarCsv } from '@/lib/csv'
import { cabecalhoImpressao, escHtml, imprimirHtml } from '@/lib/imprimir'
import { nomeDaEmpresa, useDadosEmpresa } from '@/lib/empresa'
import { ehFinanceiro, GRUPOS_PLANO, type PlanoConta, type TipoMovimento } from '@/lib/types'
import { BotaoAtualizar, Campo, Carregando, Chip, Modal, Titulo, useToast } from '@/components/ui'
import NovoPlanoConta from '@/components/NovoPlanoConta'

const TIPOS: Record<TipoMovimento, string> = { ENTRADA: 'Entrada', SAIDA: 'Saída' }
interface Novo { pai: PlanoConta | null; tipo: TipoMovimento }

export default function CentrosCusto() {
  const { toast } = useToast()
  const { perfil } = useAuth()
  const empresa = useDadosEmpresa()
  const podeEditar = ehFinanceiro(perfil)
  const [lista, setLista] = useState<PlanoConta[] | null>(null)
  const [novo, setNovo] = useState<Novo | null>(null)
  const [edit, setEdit] = useState<PlanoConta | null>(null)
  const [inativas, setInativas] = useState(false)
  const [tipoF, setTipoF] = useState<'' | TipoMovimento>('')
  const [abertos, setAbertos] = useState<Set<number> | null>(null)
  const carregar = () => listarPlano(false).then((l) => {
    setLista(l)
    // abre os grupos (1º nível) na primeira carga
    setAbertos((a) => a ?? new Set(l.filter((c) => c.nivel === 1).map((c) => c.id)))
  }).catch((e) => { toast(e.message, 'erro'); setLista([]) })
  useEffect(() => { carregar() }, [])

  const visiveis = useMemo(() => (lista ?? []).filter((c) => (inativas || c.ativa) && (!tipoF || c.tipo === tipoF)), [lista, inativas, tipoF])
  const filhos = useMemo(() => {
    const m = new Map<number, PlanoConta[]>()
    for (const c of visiveis) if (c.pai_id) m.set(c.pai_id, [...(m.get(c.pai_id) ?? []), c])
    return m
  }, [visiveis])
  const qtdFilhos = (c: PlanoConta) => (lista ?? []).filter((x) => x.pai_id === c.id).length

  async function salvar() {
    if (!edit) return
    if (!edit.nome.trim()) { toast('Informe o nome', 'erro'); return }
    try {
      ok(await supabase.from('plano_conta').update({ nome: edit.nome.trim(), descricao: edit.descricao?.trim() || null, ativa: edit.ativa }).eq('id', edit.id))
      toast('Centro de custo salvo'); setEdit(null); carregar()
    } catch (e: any) { toast(e.message, 'erro') }
  }
  const alternar = (id: number) => setAbertos((a) => { const s = new Set(a ?? []); if (s.has(id)) s.delete(id); else s.add(id); return s })

  const ordenada = () => [...visiveis].sort((a, b) => a.codigo - b.codigo)
  function imprimir() {
    const linhas = ordenada().map((c) => `<tr><td style="font-family:monospace">${fmtCodigoPlano(c.codigo)}</td><td style="padding-left:${(c.nivel - 1) * 14 + 4}px;${c.nivel === 1 ? 'font-weight:700' : ''}">${escHtml(c.nome)}${c.ativa ? '' : ' (inativo)'}</td><td>${TIPOS[c.tipo]}</td><td>${c.nivel === 1 ? escHtml(GRUPOS_PLANO[c.grupo]) : ''}</td></tr>`).join('')
    imprimirHtml('Centros de custo', `${cabecalhoImpressao(nomeDaEmpresa(empresa), 'Centros de custo')}
      <table class="tabela"><thead><tr><th>Código</th><th>Centro de custo</th><th>Tipo</th><th>Linha da DRE</th></tr></thead><tbody class="zebra">${linhas}</tbody></table>`)
  }
  function exportar() {
    const porId = new Map((lista ?? []).map((c) => [c.id, c]))
    baixarCsv('centros-de-custo', ['Código', 'Nível', 'Centro de custo', 'Centro pai', 'Tipo', 'Linha da DRE', 'Descrição', 'Ativo'],
      ordenada().map((c) => [fmtCodigoPlano(c.codigo), c.nivel, c.nome, c.pai_id ? porId.get(c.pai_id)?.nome : '', TIPOS[c.tipo], GRUPOS_PLANO[c.grupo], c.descricao, c.ativa]))
  }

  if (!lista) return <Carregando />
  const raizes = visiveis.filter((c) => c.nivel === 1)
  const comFilhos = visiveis.filter((c) => filhos.has(c.id)).map((c) => c.id)

  const no = (c: PlanoConta): ReactNode => {
    const sub = filhos.get(c.id) ?? []
    const aberto = abertos?.has(c.id)
    const podeFilho = podeEditar && c.ativa && c.nivel < NIVEL_MAX && qtdFilhos(c) < MAX_FILHOS
    return (
      <div key={c.id}>
        <div className={`flex items-center gap-2 border-b border-slate-100 py-1 pr-2 text-xs hover:bg-grafite-50 ${c.ativa ? '' : 'opacity-60'} ${c.nivel === 1 ? 'bg-slate-50' : ''}`}
          style={{ paddingLeft: `${(c.nivel - 1) * 1.25 + 0.25}rem` }}>
          <button className={`w-5 shrink-0 text-slate-500 ${sub.length ? '' : 'invisible'}`} onClick={() => alternar(c.id)} aria-label={aberto ? 'Recolher' : 'Expandir'}>{aberto ? '▾' : '▸'}</button>
          <span className="hidden w-[5.5rem] shrink-0 font-mono font-bold tabular-nums text-grafite-900 sm:inline">{fmtCodigoPlano(c.codigo)}</span>
          <span className={`min-w-0 flex-1 truncate ${c.nivel === 1 ? 'font-bold' : ''}`} title={`${fmtCodigoPlano(c.codigo)} — ${c.nome}${c.descricao ? `\n${c.descricao}` : ''}`}>{c.nome}</span>
          {sub.length > 0 && !aberto && <span className="hidden text-[11px] text-slate-400 sm:inline">{sub.length} {sub.length === 1 ? 'centro' : 'centros'}</span>}
          {c.nivel === 1 && <span className="hidden md:inline"><Chip cor="cinza" title="Linha da DRE (herdada pelos centros abaixo)">{GRUPOS_PLANO[c.grupo]}</Chip></span>}
          <span className="hidden sm:inline"><Chip cor={c.tipo === 'ENTRADA' ? 'verde' : 'vermelho'}>{TIPOS[c.tipo]}</Chip></span>
          {!c.ativa && <Chip cor="cinza">inativo</Chip>}
          {podeFilho && <button className="btn-secondary py-0 text-[11px]" title={`Novo centro abaixo deste (${NOME_NIVEL[c.nivel + 1]})`} onClick={() => setNovo({ pai: c, tipo: c.tipo })}>+ Filho</button>}
          <button className="btn-secondary py-0 text-[11px]" onClick={() => setEdit({ ...c })}>{podeEditar ? 'Editar' : 'Ver'}</button>
        </div>
        {aberto && sub.map(no)}
      </div>
    )
  }

  const paiDe = (c: PlanoConta) => lista.find((x) => x.id === c.pai_id)
  return (
    <div className="mx-auto max-w-5xl">
      <Titulo acoes={<>
        <BotaoAtualizar onClick={carregar} />
        <button className="btn-secondary" onClick={imprimir}>🖨️</button>
        <button className="btn-secondary" onClick={exportar}>⬇ CSV</button>
        {podeEditar && <button className="btn-primary" onClick={() => setNovo({ pai: null, tipo: tipoF || 'SAIDA' })}>+ Novo centro (1º nível)</button>}
      </>}>Centros de custo</Titulo>
      <div className="barra mb-2 flex flex-wrap items-center gap-2 text-xs">
        <select className="input w-auto" title="Tipo" value={tipoF} onChange={(e) => setTipoF(e.target.value as '' | TipoMovimento)}>
          <option value="">Entradas e saídas</option><option value="ENTRADA">▲ Entradas (receitas)</option><option value="SAIDA">▼ Saídas (despesas)</option>
        </select>
        <label className="flex items-center gap-1"><input type="checkbox" checked={inativas} onChange={(e) => setInativas(e.target.checked)} /> mostrar inativos</label>
        <span className="ml-auto flex gap-1">
          <button className="btn-secondary py-0.5" onClick={() => setAbertos(new Set(comFilhos))}>Expandir tudo</button>
          <button className="btn-secondary py-0.5" onClick={() => setAbertos(new Set())}>Recolher tudo</button>
        </span>
      </div>
      <div className="card overflow-hidden">{raizes.length ? raizes.map(no) : <div className="p-3 text-xs text-slate-500">Nenhum centro de custo.</div>}</div>
      <div className="mt-2 space-y-1 text-[11px] text-slate-500">
        <p>O <b>1º nível</b> agrupa: define se os centros abaixo dele são de <b>entrada</b> ou de <b>saída</b> (é o que direciona o lançamento) e em que linha da <b>DRE</b> entram (receita bruta, deduções, custos, despesas operacionais, financeiras, impostos sobre o lucro). Aportes, empréstimos, investimentos e distribuição de lucros movimentam o caixa, mas ficam fora da DRE.</p>
        <p>Os lançamentos, contas a pagar/receber e o orçamento vão nos centros do <b>2º nível para baixo</b> (até {NIVEL_MAX} níveis). O código é gerado pelo sistema e não muda. Centro com lançamentos não é excluído: desative-o (os centros abaixo dele são desativados juntos).</p>
      </div>

      {novo && <NovoPlanoConta lista={lista} pai={novo.pai} tipo={novo.tipo} onFechar={(criada) => {
        setNovo(null)
        if (!criada) return
        const abrir: number[] = []
        for (let id = criada.pai_id; id; id = lista.find((x) => x.id === id)?.pai_id ?? null) abrir.push(id)
        setAbertos((a) => new Set([...(a ?? []), ...abrir]))
        carregar()
      }} />}

      <Modal aberto={!!edit} titulo="Centro de custo" onFechar={() => setEdit(null)} largura="max-w-lg">
        {edit && (
          <div className="ficha grid grid-cols-2 gap-2">
            <Campo label="Código"><div className="input bg-slate-50 font-mono font-bold">{fmtCodigoPlano(edit.codigo)}</div></Campo>
            <Campo label="Nível"><div className="input bg-slate-50">{NOME_NIVEL[edit.nivel]}</div></Campo>
            <Campo label="Centro pai" className="col-span-2"><div className="input bg-slate-50">{edit.pai_id ? `${fmtCodigoPlano(paiDe(edit)?.codigo ?? 0)} — ${paiDe(edit)?.nome ?? ''}` : 'Nenhum (1º nível)'}</div></Campo>
            <Campo label="Tipo"><div className="input bg-slate-50">{TIPOS[edit.tipo]}</div></Campo>
            <Campo label="Linha da DRE"><div className="input bg-slate-50 truncate" title={GRUPOS_PLANO[edit.grupo]}>{GRUPOS_PLANO[edit.grupo]}</div></Campo>
            <Campo label="Nome" className="col-span-2"><input className="input" autoFocus disabled={!podeEditar} value={edit.nome} onChange={(e) => setEdit({ ...edit, nome: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && podeEditar && salvar()} /></Campo>
            <Campo label="Descrição (o que entra neste centro)" className="col-span-2"><textarea className="input min-h-[50px]" disabled={!podeEditar} value={edit.descricao ?? ''} onChange={(e) => setEdit({ ...edit, descricao: e.target.value })} /></Campo>
            <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" disabled={!podeEditar} checked={edit.ativa} onChange={(e) => setEdit({ ...edit, ativa: e.target.checked })} /> Ativo</label>
            {!edit.ativa && qtdFilhos(edit) > 0 && lista.find((x) => x.id === edit.id)?.ativa && <div className="col-span-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-900">Os {qtdFilhos(edit)} centros abaixo deste (e os abaixo deles) também serão desativados.</div>}
            <div className="acoes col-span-2 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setEdit(null)}>{podeEditar ? 'Cancelar' : 'Fechar'}</button>
              {podeEditar && <button className="btn-primary" onClick={salvar}>Salvar</button>}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
