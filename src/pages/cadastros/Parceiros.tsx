// Clientes e fornecedores (0002, tabela parceiro): quem paga e a quem a empresa paga. Documento (CPF/CNPJ) validado e
// guardado só com dígitos; "Buscar CNPJ" na BrasilAPI e CEP no ViaCEP preenchem só o que está vazio.
// Incluir/alterar: operador do financeiro; excluir: financeiro completo (em uso → o banco recusa: desative).
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, ok } from '@/lib/supabase'
import { todas } from '@/lib/dados'
import { useAuth } from '@/lib/auth'
import { fmtMoeda, fmtTelefone, normalizar, somar, somenteDigitos } from '@/lib/format'
import { erroDocumento, fmtDocumento } from '@/lib/documento'
import { buscarCnpj, preencherVazios } from '@/lib/consultas'
import { baixarCsv } from '@/lib/csv'
import { ehFinanceiro, ehOperador, TIPOS_PARCEIRO, type Parceiro, type TipoParceiro } from '@/lib/types'
import { BotaoAtualizar, Campo, Carregando, Chip, Confirmar, Modal, Opcoes, Titulo, useToast, Vazio } from '@/components/ui'
import EnderecoCampos from '@/components/EnderecoCampos'

const COR_TIPO: Record<TipoParceiro, 'azul' | 'amarelo' | 'roxo'> = { CLIENTE: 'azul', FORNECEDOR: 'amarelo', AMBOS: 'roxo' }
const NOVO: Partial<Parceiro> = { tipo: 'FORNECEDOR', pessoa: 'PJ', ativo: true }
/** colunas gravadas (o resto é carimbo/empresa) */
const COLUNAS = ['tipo', 'pessoa', 'nome', 'nome_fantasia', 'documento', 'inscricao_estadual', 'email', 'telefone', 'contato', 'cep', 'endereco', 'numero',
  'complemento', 'bairro', 'cidade', 'uf', 'banco', 'agencia', 'conta', 'pix', 'observacao', 'ativo'] as const

export default function Parceiros() {
  const { toast } = useToast()
  const { perfil } = useAuth()
  const podeEditar = ehOperador(perfil)
  const [lista, setLista] = useState<Parceiro[] | null>(null)
  const [tipoF, setTipoF] = useState<'' | 'CLIENTE' | 'FORNECEDOR'>('')
  const [situacao, setSituacao] = useState<'ativos' | 'inativos' | 'todos'>('ativos')
  const [busca, setBusca] = useState('')
  const [edit, setEdit] = useState<Partial<Parceiro> | null>(null)
  const carregar = () => todas<Parceiro>((de, ate) => supabase.from('parceiro').select('*').order('nome').order('id').range(de, ate))
    .then(setLista).catch((e) => { toast(e.message, 'erro'); setLista([]) })
  useEffect(() => { carregar() }, [])

  const visiveis = useMemo(() => {
    const t = normalizar(busca.trim()), dig = somenteDigitos(busca)
    return (lista ?? []).filter((p) => (situacao === 'todos' || (situacao === 'ativos') === p.ativo)
      && (!tipoF || p.tipo === tipoF || p.tipo === 'AMBOS')
      && (!t || normalizar(`${p.nome} ${p.nome_fantasia ?? ''} ${p.email ?? ''} ${p.cidade ?? ''} ${p.contato ?? ''}`).includes(t) || (dig.length >= 3 && (p.documento ?? '').includes(dig))))
  }, [lista, tipoF, situacao, busca])

  function exportar() {
    baixarCsv('clientes-fornecedores', ['Tipo', 'Pessoa', 'Nome / razão social', 'Nome fantasia', 'CPF/CNPJ', 'IE', 'E-mail', 'Telefone', 'Contato', 'CEP', 'Endereço', 'Número', 'Complemento', 'Bairro', 'Cidade', 'UF', 'Banco', 'Agência', 'Conta', 'PIX', 'Ativo'],
      visiveis.map((p) => [TIPOS_PARCEIRO[p.tipo], p.pessoa, p.nome, p.nome_fantasia, fmtDocumento(p.documento), p.inscricao_estadual, p.email, fmtTelefone(p.telefone), p.contato, p.cep, p.endereco, p.numero, p.complemento, p.bairro, p.cidade, p.uf, p.banco, p.agencia, p.conta, p.pix, p.ativo]))
  }

  if (!lista) return <Carregando />
  return (
    <div className="flex h-full flex-col">
      <div className="barra">
        <Titulo>Clientes e fornecedores</Titulo>
        <BotaoAtualizar onClick={carregar} />
        <Campo label="Tipo">
          <select className="input" value={tipoF} onChange={(e) => setTipoF(e.target.value as typeof tipoF)}>
            <option value="">Todos</option><option value="CLIENTE">Clientes</option><option value="FORNECEDOR">Fornecedores</option>
          </select>
        </Campo>
        <Campo label="Situação">
          <select className="input" value={situacao} onChange={(e) => setSituacao(e.target.value as typeof situacao)}>
            <option value="ativos">Ativos</option><option value="inativos">Inativos</option><option value="todos">Todos</option>
          </select>
        </Campo>
        <Campo label="Buscar"><input className="input" type="text" placeholder="nome, CPF/CNPJ, e-mail, cidade…" value={busca} onChange={(e) => setBusca(e.target.value)} /></Campo>
        <span className="text-[11px] text-slate-500">{visiveis.length} de {lista.length}</span>
        <div className="ml-auto flex gap-1.5">
          <button className="btn-secondary" onClick={exportar} title="Exportar a lista para planilha (CSV)">⬇ CSV</button>
          {podeEditar && <button className="btn-primary" onClick={() => setEdit({ ...NOVO, tipo: tipoF || 'FORNECEDOR' })}>+ Novo</button>}
        </div>
      </div>
      <div className="card flex-1 min-h-0 overflow-auto">
        {visiveis.length === 0 ? <Vazio texto={lista.length ? 'Ninguém com esse filtro' : 'Nenhum cliente ou fornecedor cadastrado'} /> : (
          <table className="tabela">
            <thead><tr><th>Nome</th><th>Tipo</th><th>CPF/CNPJ</th><th>Contato</th><th>Cidade</th><th></th></tr></thead>
            <tbody>
              {visiveis.map((p) => (
                <tr key={p.id} className={`cursor-pointer hover:bg-grafite-50 ${p.ativo ? '' : 'text-slate-400'}`} onClick={() => setEdit(p)}>
                  <td className="font-semibold">{p.nome_fantasia || p.nome}{p.nome_fantasia && <span className="ml-1 text-[10px] font-normal text-slate-400">{p.nome}</span>}{!p.ativo && <span className="ml-1"><Chip cor="cinza">inativo</Chip></span>}</td>
                  <td><Chip cor={COR_TIPO[p.tipo]}>{TIPOS_PARCEIRO[p.tipo]}</Chip></td>
                  <td className="whitespace-nowrap tabular-nums">{fmtDocumento(p.documento)}</td>
                  <td className="whitespace-nowrap">{[fmtTelefone(p.telefone), p.email].filter(Boolean).join(' · ')}</td>
                  <td>{[p.cidade, p.uf].filter(Boolean).join('/')}</td>
                  <td className="text-right"><button className="btn-secondary py-0.5">Abrir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {edit && <FichaParceiro inicial={edit} podeEditar={podeEditar} podeExcluir={ehFinanceiro(perfil)} onFechar={(mudou) => { setEdit(null); if (mudou) carregar() }} />}
    </div>
  )
}

interface ResumoTitulos { pagar: number; pagarVencido: number; receber: number; receberVencido: number; qtd: number }

function FichaParceiro({ inicial, podeEditar, podeExcluir, onFechar }: { inicial: Partial<Parceiro>; podeEditar: boolean; podeExcluir: boolean; onFechar: (mudou: boolean) => void }) {
  const { toast } = useToast()
  const [p, setP] = useState<Partial<Parceiro>>(inicial)
  const [salvando, setSalvando] = useState(false)
  const [buscando, setBuscando] = useState(false)
  const [confirma, setConfirma] = useState(false)
  const [resumo, setResumo] = useState<ResumoTitulos | null>(null)
  const set = (patch: Partial<Parceiro>) => setP((x) => ({ ...x, ...patch }))
  const doc = p.documento ?? ''
  const erroDoc = somenteDigitos(doc).length === (p.pessoa === 'PF' ? 11 : 14) ? erroDocumento(p.pessoa ?? 'PJ', doc) : doc ? `${p.pessoa === 'PF' ? 'CPF' : 'CNPJ'} incompleto` : null

  useEffect(() => {
    if (!inicial.id) return
    Promise.resolve(supabase.from('v_titulo').select('tipo, saldo, vencido').eq('parceiro_id', inicial.id).in('situacao', ['ABERTO', 'PARCIAL']))
      .then((r) => {
        const l = ok(r) as { tipo: 'PAGAR' | 'RECEBER'; saldo: number; vencido: boolean }[]
        const s = (tipo: string, venc?: boolean) => somar(l.filter((x) => x.tipo === tipo && (!venc || x.vencido)).map((x) => x.saldo))
        setResumo({ pagar: s('PAGAR'), pagarVencido: s('PAGAR', true), receber: s('RECEBER'), receberVencido: s('RECEBER', true), qtd: l.length })
      }).catch(() => setResumo(null))
  }, [inicial.id])

  async function consultarCnpj() {
    setBuscando(true)
    try {
      const d = await buscarCnpj(doc)
      setP((x) => preencherVazios(x, d as Partial<Record<keyof Parceiro, string | null>>))
      toast('Dados da Receita preenchidos nos campos vazios', 'info')
    } catch (e: any) { toast(e.message, 'erro') } finally { setBuscando(false) }
  }

  async function salvar() {
    if (!p.nome?.trim()) { toast(`Informe o ${p.pessoa === 'PF' ? 'nome' : 'nome ou razão social'}`, 'erro'); return }
    if (erroDoc) { toast(erroDoc, 'erro'); return }
    setSalvando(true)
    try {
      const dados = Object.fromEntries(COLUNAS.map((k) => [k, typeof p[k] === 'string' ? ((p[k] as string).trim() || null) : p[k] ?? null]))
      dados.documento = somenteDigitos(doc) || null
      dados.ativo = p.ativo ?? true
      if (p.id) ok(await supabase.from('parceiro').update(dados).eq('id', p.id))
      else ok(await supabase.from('parceiro').insert(dados))
      toast('Cadastro salvo'); onFechar(true)
    } catch (e: any) { toast(e.message, 'erro') } finally { setSalvando(false) }
  }
  async function excluir() {
    setConfirma(false)
    try { ok(await supabase.from('parceiro').delete().eq('id', p.id!)); toast('Cadastro excluído'); onFechar(true) }
    catch (e: any) { toast(`${e.message} Desmarque "Ativo" para tirá-lo das listas.`, 'erro') }
  }

  const txt = (k: keyof Parceiro, rotulo: string, className = '', extra: Record<string, unknown> = {}) => (
    <Campo label={rotulo} className={className}><input className="input" disabled={!podeEditar} value={(p[k] as string | null) ?? ''} onChange={(e) => set({ [k]: e.target.value } as Partial<Parceiro>)} {...extra} /></Campo>
  )
  return (
    <Modal aberto titulo={p.id ? (p.nome_fantasia || p.nome || 'Cadastro') : 'Novo cliente ou fornecedor'} onFechar={() => onFechar(false)}>
      <div className="mx-auto max-w-4xl">
        {resumo && resumo.qtd > 0 && (
          <div className="mb-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {resumo.pagar > 0 && <Link to={`/financeiro/pagar?parceiro=${p.id}`} className="card border-l-4 border-l-red-600 px-3 py-1.5 hover:bg-slate-50">
              <span className="text-slate-500">A pagar em aberto </span><b className="tabular-nums">{fmtMoeda(resumo.pagar)}</b>
              {resumo.pagarVencido > 0 && <span className="ml-1 text-red-700">({fmtMoeda(resumo.pagarVencido)} vencido)</span>}</Link>}
            {resumo.receber > 0 && <Link to={`/financeiro/receber?parceiro=${p.id}`} className="card border-l-4 border-l-emerald-600 px-3 py-1.5 hover:bg-slate-50">
              <span className="text-slate-500">A receber em aberto </span><b className="tabular-nums">{fmtMoeda(resumo.receber)}</b>
              {resumo.receberVencido > 0 && <span className="ml-1 text-red-700">({fmtMoeda(resumo.receberVencido)} vencido)</span>}</Link>}
          </div>
        )}
        <div className="ficha grid grid-cols-1 gap-2 sm:grid-cols-4">
          <Campo label="Tipo"><Opcoes valor={p.tipo} opcoes={TIPOS_PARCEIRO} vazio={null} disabled={!podeEditar} onChange={(v) => set({ tipo: v as TipoParceiro })} /></Campo>
          <Campo label="Pessoa">
            <select className="input" disabled={!podeEditar} value={p.pessoa ?? 'PJ'} onChange={(e) => set({ pessoa: e.target.value as 'PF' | 'PJ', documento: null })}>
              <option value="PJ">Jurídica (CNPJ)</option><option value="PF">Física (CPF)</option>
            </select>
          </Campo>
          <Campo label={p.pessoa === 'PF' ? 'CPF' : 'CNPJ'}>
            <div className="flex gap-1">
              <input className={`input tabular-nums ${erroDoc && somenteDigitos(doc).length === (p.pessoa === 'PF' ? 11 : 14) ? 'border-red-500' : ''}`} inputMode="numeric" disabled={!podeEditar}
                value={fmtDocumento(doc)} onChange={(e) => set({ documento: somenteDigitos(e.target.value).slice(0, p.pessoa === 'PF' ? 11 : 14) })} />
              {podeEditar && p.pessoa !== 'PF' && <button type="button" className="btn-secondary shrink-0 px-2" title="Buscar os dados na Receita (BrasilAPI)" disabled={buscando || somenteDigitos(doc).length !== 14 || !!erroDoc} onClick={consultarCnpj}>{buscando ? '…' : '🔍'}</button>}
            </div>
            {erroDoc && somenteDigitos(doc).length === (p.pessoa === 'PF' ? 11 : 14) && <span className="text-[10px] font-semibold text-red-600">{erroDoc}</span>}
          </Campo>
          {txt('inscricao_estadual', p.pessoa === 'PF' ? 'RG / IE (opcional)' : 'Inscrição estadual')}
          {txt('nome', p.pessoa === 'PF' ? 'Nome completo' : 'Razão social', 'sm:col-span-2', { autoFocus: !p.id })}
          {txt('nome_fantasia', 'Nome fantasia (como aparece nas listas)', 'sm:col-span-2')}
          {txt('email', 'E-mail', 'sm:col-span-2', { type: 'email' })}
          <Campo label="Telefone"><input className="input" inputMode="tel" disabled={!podeEditar} value={fmtTelefone(p.telefone)} onChange={(e) => set({ telefone: somenteDigitos(e.target.value).slice(0, 11) })} /></Campo>
          {txt('contato', 'Pessoa de contato')}
          <EnderecoCampos valor={p} onChange={(v) => setP(v)} desabilitado={!podeEditar} />
          <div className="sm:col-span-4 mt-1 label">Dados bancários (para pagar o fornecedor ou conferir o recebimento)</div>
          {txt('banco', 'Banco')}
          {txt('agencia', 'Agência')}
          {txt('conta', 'Conta')}
          {txt('pix', 'Chave PIX')}
          <Campo label="Observação" className="sm:col-span-4">
            <textarea className="input min-h-[60px]" disabled={!podeEditar} value={p.observacao ?? ''} onChange={(e) => set({ observacao: e.target.value })} />
          </Campo>
          <label className="flex items-center gap-2 text-sm sm:col-span-4"><input type="checkbox" disabled={!podeEditar} checked={p.ativo ?? true} onChange={(e) => set({ ativo: e.target.checked })} /> Ativo (inativo sai das listas de escolha, mas o histórico fica)</label>
          <div className="acoes sm:col-span-4 flex items-center justify-between gap-2 pt-1">
            <div>{p.id && podeExcluir && <button className="btn-danger" onClick={() => setConfirma(true)}>Excluir</button>}</div>
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={() => onFechar(false)}>{podeEditar ? 'Cancelar' : 'Fechar'}</button>
              {podeEditar && <button className="btn-primary" disabled={salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar'}</button>}
            </div>
          </div>
        </div>
      </div>
      <Confirmar aberto={confirma} perigo titulo="Excluir cadastro" texto={`Excluir ${p.nome}? Se houver títulos ou lançamentos com ele, o sistema não deixa: desative o cadastro.`} onNao={() => setConfirma(false)} onSim={excluir} />
    </Modal>
  )
}
