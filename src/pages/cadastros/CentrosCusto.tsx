// Centros de custo (0002): departamentos, filiais ou projetos — a segunda dimensão dos lançamentos e títulos, além do
// plano de contas (ex.: "Energia elétrica" no centro "Loja Centro"). A DRE e o painel filtram por centro.
import { useEffect, useState } from 'react'
import { supabase, ok } from '@/lib/supabase'
import { listarCentros } from '@/lib/dados'
import { useAuth } from '@/lib/auth'
import { ehFinanceiro, type CentroCusto } from '@/lib/types'
import { BotaoAtualizar, Campo, Carregando, Chip, Confirmar, Modal, Titulo, useToast } from '@/components/ui'

export default function CentrosCusto() {
  const { toast } = useToast()
  const { perfil } = useAuth()
  const podeEditar = ehFinanceiro(perfil)
  const [lista, setLista] = useState<CentroCusto[] | null>(null)
  const [inativos, setInativos] = useState(false)
  const [edit, setEdit] = useState<Partial<CentroCusto> | null>(null)
  const [apagar, setApagar] = useState(false)
  const carregar = () => listarCentros(false).then(setLista).catch((e) => { toast(e.message, 'erro'); setLista([]) })
  useEffect(() => { carregar() }, [])

  async function salvar() {
    if (!edit?.nome?.trim()) { toast('Informe o nome', 'erro'); return }
    const dados = { codigo: edit.codigo?.trim() || null, nome: edit.nome.trim(), descricao: edit.descricao?.trim() || null, ativo: edit.ativo ?? true }
    try {
      if (edit.id) ok(await supabase.from('centro_custo').update(dados).eq('id', edit.id))
      else ok(await supabase.from('centro_custo').insert(dados))
      toast('Centro de custo salvo'); setEdit(null); carregar()
    } catch (e: any) { toast(e.message, 'erro') }
  }
  async function excluir() {
    setApagar(false)
    try { ok(await supabase.from('centro_custo').delete().eq('id', edit!.id!)); toast('Centro de custo excluído'); setEdit(null); carregar() }
    catch (e: any) { toast(e.message, 'erro') }
  }

  if (!lista) return <Carregando />
  const visiveis = lista.filter((c) => inativos || c.ativo)
  return (
    <div className="mx-auto max-w-3xl">
      <Titulo acoes={<>
        <BotaoAtualizar onClick={carregar} />
        {podeEditar && <button className="btn-primary" onClick={() => setEdit({ nome: '', ativo: true })}>+ Novo centro</button>}
      </>}>Centros de custo</Titulo>
      <div className="mb-1.5 flex items-center gap-2 text-xs">
        <label className="flex items-center gap-1"><input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} /> mostrar inativos</label>
      </div>
      <div className="card overflow-auto">
        <table className="tabela">
          <thead><tr><th>Código</th><th>Nome</th><th>Descrição</th><th></th></tr></thead>
          <tbody>
            {visiveis.map((c) => (
              <tr key={c.id} className={`cursor-pointer hover:bg-grafite-50 ${c.ativo ? '' : 'text-slate-400'}`} onClick={() => setEdit(c)}>
                <td className="font-mono">{c.codigo}</td>
                <td className="font-semibold">{c.nome} {!c.ativo && <Chip cor="cinza">inativo</Chip>}</td>
                <td>{c.descricao}</td>
                <td className="text-right"><button className="btn-secondary py-0.5">{podeEditar ? 'Editar' : 'Ver'}</button></td>
              </tr>
            ))}
            {visiveis.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-slate-400">Nenhum centro de custo.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-slate-500">
        Centros de custo são <b>departamentos, filiais ou projetos</b>: a segunda dimensão, além do plano de contas. O plano diz <i>o que</i> foi
        (ex.: energia elétrica); o centro diz <i>de quem</i> é o gasto ou a receita (ex.: Loja Centro, Projeto X). A DRE e o painel podem ser filtrados por centro.
        Centro em uso não é excluído: desative-o.
      </p>

      <Modal aberto={!!edit} titulo={edit?.id ? 'Centro de custo' : 'Novo centro de custo'} onFechar={() => setEdit(null)} largura="max-w-md">
        {edit && (
          <div className="ficha grid grid-cols-3 gap-2">
            <Campo label="Código"><input className="input" disabled={!podeEditar} value={edit.codigo ?? ''} onChange={(e) => setEdit({ ...edit, codigo: e.target.value })} placeholder="opcional" /></Campo>
            <Campo label="Nome" className="col-span-2"><input className="input" autoFocus disabled={!podeEditar} value={edit.nome ?? ''} onChange={(e) => setEdit({ ...edit, nome: e.target.value })} /></Campo>
            <Campo label="Descrição" className="col-span-3"><input className="input" disabled={!podeEditar} value={edit.descricao ?? ''} onChange={(e) => setEdit({ ...edit, descricao: e.target.value })} /></Campo>
            <label className="col-span-3 flex items-center gap-2 text-sm"><input type="checkbox" disabled={!podeEditar} checked={edit.ativo ?? true} onChange={(e) => setEdit({ ...edit, ativo: e.target.checked })} /> Ativo</label>
            <div className="acoes col-span-3 flex items-center justify-between gap-2">
              <div>{podeEditar && edit.id && <button className="btn-danger" onClick={() => setApagar(true)}>Excluir</button>}</div>
              <div className="flex gap-2">
                <button className="btn-secondary" onClick={() => setEdit(null)}>{podeEditar ? 'Cancelar' : 'Fechar'}</button>
                {podeEditar && <button className="btn-primary" onClick={salvar}>Salvar</button>}
              </div>
            </div>
          </div>
        )}
      </Modal>
      <Confirmar aberto={apagar} perigo titulo="Excluir centro de custo" texto={`Excluir "${edit?.nome}"? Se ele já foi usado em lançamentos ou títulos, o sistema não deixa: desative-o.`} onNao={() => setApagar(false)} onSim={excluir} />
    </div>
  )
}
