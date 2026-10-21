// Usuários da empresa em uso: quem tem acesso (usuario_empresa: papel e ativo) e pré-liberações por e-mail Google.
// Fluxo (o do Luminexus): o administrador libera o e-mail com o papel; a pessoa entra com o Google e já tem acesso.
// A mesma conta pode ter acesso a mais de uma empresa. O banco impede o ADMIN de mudar o próprio papel e de dar
// o papel Diretoria (só a diretoria dá) — a tela só esconde o que não vai funcionar.
import { useEffect, useMemo, useState } from 'react'
import { supabase, ok } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { fmtDataHora } from '@/lib/format'
import { ehDiretor, PAPEIS, PAPEIS_EMPRESA, PAPEL_PARA, type LiberacaoPrevia, type Papel, type PapelEmpresa, type UsuarioEmpresa } from '@/lib/types'
import { BotaoAtualizar, Bloco, Campo, Carregando, Chip, Confirmar, Modal, Titulo, useToast } from '@/components/ui'

const COR_PAPEL: Record<Papel, 'azul' | 'verde' | 'amarelo' | 'cinza' | 'roxo' | 'vermelho'> = {
  ADMIN_TI: 'roxo', DIRETOR: 'roxo', ADMIN: 'azul', FINANCEIRO: 'verde', FINANCEIRO_AUX: 'amarelo', CONTADOR: 'cinza',
}

export default function Usuarios() {
  const { toast } = useToast()
  const { usuario: eu, empresa, perfil, recarregar } = useAuth()
  const diretor = ehDiretor(perfil)
  // papéis que este usuário pode dar (DIRETOR só a diretoria)
  const papeisPermitidos = Object.fromEntries(Object.entries(PAPEIS_EMPRESA).filter(([k]) => diretor || k !== 'DIRETOR')) as Record<PapelEmpresa, string>
  const [lista, setLista] = useState<UsuarioEmpresa[] | null>(null)
  const [previas, setPrevias] = useState<LiberacaoPrevia[]>([])
  const [edit, setEdit] = useState<UsuarioEmpresa | null>(null)
  const [nova, setNova] = useState<{ email: string; papel: PapelEmpresa; nome: string }>({ email: '', papel: 'FINANCEIRO', nome: '' })
  const [apagar, setApagar] = useState<LiberacaoPrevia | null>(null)
  const [remover, setRemover] = useState<UsuarioEmpresa | null>(null)
  const [busca, setBusca] = useState('')

  const carregar = async () => {
    try {
      const [u, p] = await Promise.all([
        Promise.resolve(supabase.from('usuario_empresa').select('*, usuario:usuario_id(nome, email, papel)').eq('empresa_id', empresa!.empresa_id).order('papel')).then((r) => ok(r) as UsuarioEmpresa[]),
        Promise.resolve(supabase.from('liberacao_previa').select('*').eq('empresa_id', empresa!.empresa_id).order('criado_em', { ascending: false })).then((r) => ok(r) as LiberacaoPrevia[]),
      ])
      setLista(u.sort((a, b) => (a.usuario?.nome ?? '').localeCompare(b.usuario?.nome ?? '')))
      setPrevias(p)
    } catch (e: any) { toast(e.message, 'erro'); setLista([]) }
  }
  useEffect(() => { carregar() }, [empresa?.empresa_id])

  const ehEu = (u: UsuarioEmpresa) => u.usuario_id === eu?.id
  async function salvar() {
    if (!edit) return
    try {
      ok(await supabase.from('usuario_empresa').update({ papel: edit.papel, ativo: edit.ativo }).eq('usuario_id', edit.usuario_id).eq('empresa_id', edit.empresa_id).select('usuario_id').single())
      toast('Acesso salvo'); setEdit(null); carregar()
      if (ehEu(edit)) recarregar()
    } catch (e: any) { toast(/0 rows|JSON object requested/i.test(e.message) ? 'O banco não permitiu a alteração (seu papel não pode mudar este usuário).' : e.message, 'erro') }
  }
  async function liberar() {
    const email = nova.email.trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('Informe um e-mail Google válido', 'erro'); return }
    try {
      ok(await supabase.from('liberacao_previa').upsert({ empresa_id: empresa!.empresa_id, email, papel: nova.papel, nome: nova.nome.trim() || null, usada_em: null }))
      toast(`${email} liberado como ${PAPEIS[nova.papel]}. Se já tem conta, o acesso vale agora; senão, vale no primeiro login com o Google.`)
      setNova({ email: '', papel: nova.papel, nome: '' }); carregar()
    } catch (e: any) { toast(e.message, 'erro') }
  }
  async function confirmarApagar() {
    if (!apagar) return
    try { ok(await supabase.from('liberacao_previa').delete().eq('empresa_id', apagar.empresa_id).eq('email', apagar.email)); setApagar(null); carregar() } catch (e: any) { toast(e.message, 'erro') }
  }
  async function confirmarRemover() {
    if (!remover) return
    try { ok(await supabase.from('usuario_empresa').delete().eq('usuario_id', remover.usuario_id).eq('empresa_id', remover.empresa_id)); toast('Acesso removido'); setRemover(null); carregar() } catch (e: any) { toast(e.message, 'erro') }
  }

  const filtrada = useMemo(() => {
    const b = busca.trim().toLowerCase()
    return (lista ?? []).filter((u) => !b || `${u.usuario?.nome} ${u.usuario?.email} ${PAPEIS[u.papel]}`.toLowerCase().includes(b))
  }, [lista, busca])
  if (!lista) return <Carregando />
  const abertas = previas.filter((p) => !p.usada_em)
  return (
    <div className="mx-auto max-w-4xl">
      <Titulo acoes={<BotaoAtualizar onClick={carregar} />}>Usuários · {empresa?.nome_fantasia || empresa?.razao_social}</Titulo>
      <div className="card px-3 py-1.5 mb-1.5 text-xs text-slate-600">
        Informe o <b>e-mail Google</b> da pessoa e o papel. Ela entra no Finanway com o Google e já tem acesso a esta empresa; quem já tem conta
        recebe o acesso na hora. A mesma conta pode entrar em mais de uma empresa (o contador, por exemplo, atende várias).
      </div>

      <Bloco className="p-3 mb-1.5" titulo="Liberar e-mail" contador={abertas.length || undefined} abertoInicial>
        <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-6">
          <Campo label="E-mail Google" className="sm:col-span-2"><input className="input" type="email" value={nova.email} onChange={(e) => setNova({ ...nova, email: e.target.value })} placeholder="pessoa@gmail.com" onKeyDown={(e) => e.key === 'Enter' && liberar()} /></Campo>
          <Campo label="Nome (opcional)" className="sm:col-span-2"><input className="input" value={nova.nome} onChange={(e) => setNova({ ...nova, nome: e.target.value })} /></Campo>
          <Campo label="Papel">
            <select className="input" value={nova.papel} onChange={(e) => setNova({ ...nova, papel: e.target.value as PapelEmpresa })}>
              {Object.entries(papeisPermitidos).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Campo>
          <button className="btn-primary" onClick={liberar}>Liberar</button>
        </div>
        <div className="mt-1 text-[11px] text-slate-500">{PAPEL_PARA[nova.papel]}</div>
        {abertas.length > 0 && (
          <ul className="mt-2 divide-y divide-slate-100 text-xs">
            {abertas.map((p) => (
              <li key={p.email} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1">
                <span className="min-w-0 break-all font-semibold">{p.email}</span><Chip cor={COR_PAPEL[p.papel]}>{PAPEIS[p.papel]}</Chip>
                {p.nome && <span className="text-slate-500">{p.nome}</span>}
                <span className="text-slate-400 sm:ml-auto">aguardando o 1º login com Google · {fmtDataHora(p.criado_em)}</span>
                {(diretor || p.papel !== 'DIRETOR') && <button className="px-1 text-red-600" title="Cancelar a liberação" onClick={() => setApagar(p)}>✕</button>}
              </li>
            ))}
          </ul>
        )}
      </Bloco>

      <Bloco className="p-3 mb-1.5" titulo="Papéis na empresa">
        <ul className="divide-y divide-slate-100 text-xs">
          {(Object.keys(PAPEL_PARA) as PapelEmpresa[]).map((p) => {
            const quem = lista.filter((u) => u.ativo && u.papel === p)
            const aguardando = abertas.filter((x) => x.papel === p)
            return (
              <li key={p} className="flex flex-wrap items-center gap-2 py-1.5">
                <span className="shrink-0 sm:w-40"><Chip cor={COR_PAPEL[p]}>{PAPEIS[p]}</Chip></span>
                <span className="min-w-0 basis-full sm:basis-auto sm:flex-1">
                  {quem.length ? <b>{quem.map((u) => u.usuario?.nome).join(', ')}</b> : <b className="text-slate-400">ninguém</b>}
                  {aguardando.length > 0 && <span className="text-slate-400"> · aguardando login: {aguardando.map((x) => x.email).join(', ')}</span>}
                  <span className="block text-[11px] text-slate-500">{PAPEL_PARA[p]}</span>
                </span>
              </li>
            )
          })}
        </ul>
        <div className="mt-1 text-[11px] text-slate-400">Cada conta tem um papel por empresa. Diretoria e Administrador já incluem o financeiro completo.</div>
      </Bloco>

      <div className="barra mb-1.5">
        <input className="input max-w-xs" placeholder="Buscar usuário, e-mail ou papel" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <span className="text-xs text-slate-500">{filtrada.length} de {lista.length}</span>
      </div>
      <div className="card overflow-auto">
        <table className="tabela">
          <thead><tr><th>Nome</th><th>E-mail</th><th>Papel nesta empresa</th><th>Situação</th><th></th></tr></thead>
          <tbody>
            {filtrada.map((u) => {
              // o banco não deixa mudar a si mesmo nem quem é Diretoria sem ser da diretoria
              const podeMexer = !ehEu(u) && (diretor || u.papel !== 'DIRETOR')
              return (
                <tr key={u.usuario_id}>
                  <td className="font-semibold">{u.usuario?.nome}{ehEu(u) && <span className="ml-1 text-[10px] text-slate-400">(você)</span>}{u.usuario?.papel === 'ADMIN_TI' && <span className="ml-1 text-[10px] text-slate-400">(TI)</span>}</td>
                  <td>{u.usuario?.email}</td>
                  <td><Chip cor={COR_PAPEL[u.papel]}>{PAPEIS[u.papel]}</Chip></td>
                  <td>{u.ativo ? <Chip cor="verde">ativo</Chip> : <Chip cor="vermelho">bloqueado</Chip>}</td>
                  <td className="whitespace-nowrap text-right">
                    {podeMexer ? <>
                      <button className="btn-secondary mr-1 py-0.5" onClick={() => setEdit(u)}>Editar</button>
                      <button className="px-1 text-red-600" title="Remover o acesso a esta empresa" onClick={() => setRemover(u)}>✕</button>
                    </> : <span className="text-[10px] text-slate-400">{ehEu(u) ? 'outro administrador altera' : 'só a diretoria altera'}</span>}
                  </td>
                </tr>
              )
            })}
            {lista.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-slate-400">Nenhum usuário com acesso a esta empresa ainda.</td></tr>}
          </tbody>
        </table>
      </div>

      <Modal aberto={!!edit} titulo="Acesso do usuário" onFechar={() => setEdit(null)} largura="max-w-md">
        {edit && (
          <div className="ficha grid grid-cols-1 gap-3">
            <Campo label="Nome"><input className="input" disabled value={edit.usuario?.nome ?? ''} /></Campo>
            <Campo label="E-mail"><input className="input" disabled value={edit.usuario?.email ?? ''} /></Campo>
            <Campo label="Papel nesta empresa">
              <select className="input" value={edit.papel} onChange={(e) => setEdit({ ...edit, papel: e.target.value as PapelEmpresa })}>
                {Object.entries(papeisPermitidos).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Campo>
            <div className="text-[11px] text-slate-500">{PAPEL_PARA[edit.papel]}</div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!edit.ativo} onChange={(e) => setEdit({ ...edit, ativo: e.target.checked })} /> Ativo (desmarcar bloqueia o acesso a esta empresa)</label>
            <div className="acoes flex justify-end gap-2"><button className="btn-secondary" onClick={() => setEdit(null)}>Cancelar</button><button className="btn-primary" onClick={salvar}>Salvar</button></div>
          </div>
        )}
      </Modal>
      <Confirmar aberto={!!apagar} perigo titulo="Cancelar liberação" texto={`Cancelar a liberação de ${apagar?.email}?`} onNao={() => setApagar(null)} onSim={confirmarApagar} />
      <Confirmar aberto={!!remover} perigo titulo="Remover acesso" texto={`Remover o acesso de ${remover?.usuario?.nome} a esta empresa? A conta continua existindo (e o acesso a outras empresas também).`} onNao={() => setRemover(null)} onSim={confirmarRemover} />
    </div>
  )
}
