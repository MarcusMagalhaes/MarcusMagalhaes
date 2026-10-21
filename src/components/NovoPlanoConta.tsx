// Inclusão de centro de custo (0002/0007, tabela plano_conta): o mesmo formulário na tela Centros de custo (+ Novo e
// + Filho) e nos lançamentos/títulos (+). O pai é escolhido na lista (ou "Nenhum (1º nível)"); o filho herda o tipo e o
// grupo da DRE do pai; código e nível são gerados pelo banco (fn_plano_inclusao) e não mudam depois.
import { useMemo, useState } from 'react'
import { supabase, ok } from '@/lib/supabase'
import { MAX_FILHOS, NIVEL_MAX, NOME_NIVEL, fmtCodigoPlano, proximoCodigo } from '@/lib/planoContas'
import { GRUPOS_ENTRADA, GRUPOS_PLANO, GRUPOS_SAIDA, type GrupoPlano, type PlanoConta, type TipoMovimento } from '@/lib/types'
import { Campo, Modal, useToast } from './ui'

const TIPOS: Record<TipoMovimento, string> = { ENTRADA: 'Entrada (receita)', SAIDA: 'Saída (despesa)' }

/** onFechar(criada) — criada = o centro gravado; sem argumento = cancelado */
export default function NovoPlanoConta({ lista, pai: paiInicial, tipo: tipoInicial = 'SAIDA', onFechar }: {
  lista: PlanoConta[]; pai?: PlanoConta | null; tipo?: TipoMovimento; onFechar: (criada?: PlanoConta) => void
}) {
  const { toast } = useToast()
  const [paiId, setPaiId] = useState<number | null>(paiInicial?.id ?? null)
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState<TipoMovimento>(paiInicial?.tipo ?? tipoInicial)
  const [grupo, setGrupo] = useState<GrupoPlano>(tipoInicial === 'ENTRADA' ? 'RECEITA_OPERACIONAL' : 'DESPESA_OPERACIONAL')
  const [salvando, setSalvando] = useState(false)
  const ordem = useMemo(() => [...lista].sort((a, b) => a.codigo - b.codigo), [lista])
  const qtdFilhos = (c: PlanoConta) => lista.filter((x) => x.pai_id === c.id).length
  const podeSerPai = (c: PlanoConta) => c.ativa && c.nivel < NIVEL_MAX && qtdFilhos(c) < MAX_FILHOS
  const pai = lista.find((c) => c.id === paiId) ?? null
  const prevista = proximoCodigo(lista, pai)
  const gruposDoTipo = tipo === 'ENTRADA' ? GRUPOS_ENTRADA : GRUPOS_SAIDA

  async function incluir() {
    if (!nome.trim()) { toast('Informe o nome', 'erro'); return }
    if (typeof prevista !== 'number' || salvando) return
    setSalvando(true)
    try {
      const criada = ok<PlanoConta>(await supabase.from('plano_conta').insert(pai
        ? { pai_id: pai.id, nome: nome.trim(), tipo: pai.tipo, grupo: pai.grupo }
        : { nivel: 1, nome: nome.trim(), tipo, grupo }).select('*').single())
      toast('Centro de custo incluído')
      onFechar(criada)
    } catch (e: any) { toast(e.message, 'erro'); setSalvando(false) }
  }

  return (
    <Modal aberto titulo={pai ? 'Novo centro de custo (filho)' : 'Novo centro de custo'} onFechar={() => onFechar()} largura="max-w-lg">
      <div className="ficha grid grid-cols-2 gap-2">
        <Campo label="Centro pai" className="col-span-2">
          <select className="input" value={paiId ?? ''} onChange={(e) => {
            const p = lista.find((c) => c.id === Number(e.target.value)) ?? null
            setPaiId(p?.id ?? null); if (p) setTipo(p.tipo)
          }}>
            <option value="">Nenhum (1º nível)</option>
            {ordem.filter((c) => podeSerPai(c) || c.id === paiId).map((c) => (
              <option key={c.id} value={c.id}>
                {'   '.repeat(c.nivel - 1)}{c.nivel === 1 ? (c.tipo === 'ENTRADA' ? '▲ ' : '▼ ') : ''}{fmtCodigoPlano(c.codigo)} — {c.nome}
              </option>
            ))}
          </select>
        </Campo>
        <Campo label="Nome" className="col-span-2"><input className="input" autoFocus value={nome} onChange={(e) => setNome(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && incluir()} /></Campo>
        <Campo label="Tipo">
          {pai ? <div className="input bg-slate-50">{TIPOS[pai.tipo]} (do pai)</div>
            : <select className="input" value={tipo} onChange={(e) => { const t = e.target.value as TipoMovimento; setTipo(t); setGrupo(t === 'ENTRADA' ? 'RECEITA_OPERACIONAL' : 'DESPESA_OPERACIONAL') }}>
                {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>}
        </Campo>
        <Campo label="Na DRE">
          {pai ? <div className="input bg-slate-50 truncate" title={GRUPOS_PLANO[pai.grupo]}>{GRUPOS_PLANO[pai.grupo]}</div>
            : <select className="input" value={grupo} onChange={(e) => setGrupo(e.target.value as GrupoPlano)}>
                {gruposDoTipo.map((g) => <option key={g} value={g}>{GRUPOS_PLANO[g]}</option>)}
              </select>}
        </Campo>
        <Campo label="Código (gerado)"><div className="input bg-slate-50 font-mono font-bold">{typeof prevista === 'number' ? fmtCodigoPlano(prevista) : prevista}</div></Campo>
        <Campo label="Nível"><div className="input bg-slate-50">{NOME_NIVEL[(pai?.nivel ?? 0) + 1]}</div></Campo>
        <p className="col-span-2 text-[11px] text-slate-500">
          {pai ? '' : 'O 1º nível só agrupa: os lançamentos vão nos centros abaixo dele. '}Depois de salvo, o código, o pai, o tipo e a linha da DRE não mudam.
        </p>
        <div className="acoes col-span-2 flex justify-end gap-2">
          <button className="btn-secondary" onClick={() => onFechar()}>Cancelar</button>
          <button className="btn-primary" disabled={typeof prevista !== 'number' || salvando} onClick={incluir}>Salvar</button>
        </div>
      </div>
    </Modal>
  )
}
