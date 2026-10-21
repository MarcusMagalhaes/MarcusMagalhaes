// Contas financeiras (0002): caixa, conta corrente, poupança, aplicação e cartão de crédito, com o saldo calculado pelo
// banco (v_saldo_conta: saldo inicial + entradas − saídas ± transferências confirmadas). Só o financeiro completo altera.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, ok } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { fmtData, fmtMoeda, fmtValor, mascaraMoeda, parsePreco, somar } from '@/lib/format'
import { ehFinanceiro, TIPOS_CONTA, type ContaFinanceira, type SaldoConta, type TipoConta } from '@/lib/types'
import { BotaoAtualizar, Campo, Carregando, Chip, Modal, Opcoes, Titulo, useToast } from '@/components/ui'

const COLUNAS = ['nome', 'tipo', 'banco', 'agencia', 'numero', 'pix', 'saldo_inicial', 'data_saldo_inicial', 'limite', 'observacao', 'ativa'] as const

export default function Contas() {
  const { toast } = useToast()
  const { perfil } = useAuth()
  const podeEditar = ehFinanceiro(perfil)
  const [lista, setLista] = useState<(ContaFinanceira & { saldo: number })[] | null>(null)
  const [inativas, setInativas] = useState(false)
  const [edit, setEdit] = useState<Partial<ContaFinanceira> | null>(null)
  const [saldoTxt, setSaldoTxt] = useState('')
  const [limiteTxt, setLimiteTxt] = useState('')
  const carregar = async () => {
    try {
      const [contas, saldos] = await Promise.all([
        Promise.resolve(supabase.from('conta_financeira').select('*').order('tipo').order('nome')).then((r) => ok(r) as ContaFinanceira[]),
        Promise.resolve(supabase.from('v_saldo_conta').select('id, saldo')).then((r) => ok(r) as Pick<SaldoConta, 'id' | 'saldo'>[]),
      ])
      setLista(contas.map((c) => ({ ...c, saldo: Number(saldos.find((s) => s.id === c.id)?.saldo ?? 0) })))
    } catch (e: any) { toast(e.message, 'erro'); setLista([]) }
  }
  useEffect(() => { carregar() }, [])
  const abrir = (c: Partial<ContaFinanceira>) => { setEdit(c); setSaldoTxt(c.saldo_inicial ? fmtValor(Math.abs(c.saldo_inicial)) : ''); setLimiteTxt(c.limite ? fmtValor(c.limite) : '') }
  // saldo inicial negativo (cartão com fatura aberta, cheque especial): o sinal fica num seletor, a máscara só aceita dígitos
  const [negativo, setNegativo] = useState(false)
  useEffect(() => { setNegativo((edit?.saldo_inicial ?? 0) < 0) }, [edit?.id])

  async function salvar() {
    if (!edit?.nome?.trim()) { toast('Informe o nome', 'erro'); return }
    try {
      const dados: Record<string, unknown> = Object.fromEntries(COLUNAS.map((k) => [k, edit[k] ?? null]))
      dados.nome = edit.nome.trim()
      dados.saldo_inicial = (parsePreco(saldoTxt) ?? 0) * (negativo ? -1 : 1)
      dados.limite = parsePreco(limiteTxt)
      dados.ativa = edit.ativa ?? true
      dados.data_saldo_inicial = edit.data_saldo_inicial || null
      for (const k of ['banco', 'agencia', 'numero', 'pix', 'observacao']) dados[k] = typeof dados[k] === 'string' ? (dados[k] as string).trim() || null : null
      if (edit.id) ok(await supabase.from('conta_financeira').update(dados).eq('id', edit.id))
      else ok(await supabase.from('conta_financeira').insert(dados))
      toast('Conta salva'); setEdit(null); carregar()
    } catch (e: any) { toast(e.message, 'erro') }
  }

  if (!lista) return <Carregando />
  const visiveis = lista.filter((c) => inativas || c.ativa)
  const total = somar(lista.filter((c) => c.ativa).map((c) => c.saldo))
  return (
    <div className="mx-auto max-w-5xl">
      <Titulo acoes={<>
        <BotaoAtualizar onClick={carregar} />
        {podeEditar && <button className="btn-primary" onClick={() => abrir({ nome: '', tipo: 'CONTA_CORRENTE', ativa: true, saldo_inicial: 0 })}>+ Nova conta</button>}
      </>}>Contas financeiras</Titulo>
      <div className="mb-1.5 flex flex-wrap items-center gap-3 text-xs">
        <div className="card border-l-4 border-l-grafite-700 px-3 py-1.5"><span className="text-slate-500">Saldo das contas ativas </span><b className={`tabular-nums ${total < 0 ? 'text-red-700' : ''}`}>{fmtMoeda(total)}</b></div>
        <label className="flex items-center gap-1"><input type="checkbox" checked={inativas} onChange={(e) => setInativas(e.target.checked)} /> mostrar inativas</label>
      </div>
      <div className="card overflow-auto">
        <table className="tabela">
          <thead><tr><th>Conta</th><th>Tipo</th><th>Banco · agência · nº</th><th className="text-right">Saldo inicial</th><th className="text-right">Saldo atual</th><th></th></tr></thead>
          <tbody>
            {visiveis.map((c) => (
              <tr key={c.id} className={!c.ativa ? 'text-slate-400' : ''}>
                <td className="font-semibold">{c.nome} {!c.ativa && <Chip cor="cinza">inativa</Chip>}</td>
                <td>{TIPOS_CONTA[c.tipo]}</td>
                <td>{[c.banco, c.agencia, c.numero].filter(Boolean).join(' · ')}{c.pix && <span className="ml-1 text-[10px] text-slate-400">PIX {c.pix}</span>}</td>
                <td className="num">{fmtValor(c.saldo_inicial)}{c.data_saldo_inicial && <span className="text-[10px] text-slate-400"> em {fmtData(c.data_saldo_inicial)}</span>}</td>
                <td className={`num font-bold ${c.saldo < 0 ? 'text-red-700' : ''}`}>{fmtValor(c.saldo)}{c.limite != null && <span className="block text-[10px] font-normal text-slate-400">limite {fmtValor(c.limite)}</span>}</td>
                <td className="whitespace-nowrap text-right">
                  <Link className="btn-secondary mr-1 py-0.5" to={`/relatorios/extrato?conta=${c.id}`}>Extrato</Link>
                  <button className="btn-secondary py-0.5" onClick={() => abrir(c)}>{podeEditar ? 'Editar' : 'Ver'}</button>
                </td>
              </tr>
            ))}
            {visiveis.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-slate-400">Nenhuma conta cadastrada.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="mt-2 space-y-1 text-[11px] text-slate-500">
        <p>Saldo atual = saldo inicial + entradas − saídas ± transferências (só lançamentos confirmados; os pendentes da conciliação ficam de fora). Informe o saldo inicial com a data em que o controle começou no Finanway.</p>
        <p><b>Cartão de crédito:</b> cadastre o cartão como uma conta. As compras são saídas da conta do cartão (o saldo fica negativo: é a fatura em aberto); pagar a fatura é uma <b>transferência</b> da conta corrente para o cartão.</p>
      </div>

      <Modal aberto={!!edit} titulo={edit?.id ? 'Conta' : 'Nova conta'} onFechar={() => setEdit(null)} largura="max-w-lg">
        {edit && (
          <div className="ficha grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Campo label="Nome" className="sm:col-span-2"><input className="input" autoFocus disabled={!podeEditar} value={edit.nome ?? ''} onChange={(e) => setEdit({ ...edit, nome: e.target.value })} placeholder="ex.: Itaú – conta corrente" /></Campo>
            <Campo label="Tipo"><Opcoes valor={edit.tipo} opcoes={TIPOS_CONTA} disabled={!podeEditar} onChange={(v) => setEdit({ ...edit, tipo: v as TipoConta })} vazio={null} /></Campo>
            <Campo label="Banco"><input className="input" disabled={!podeEditar} value={edit.banco ?? ''} onChange={(e) => setEdit({ ...edit, banco: e.target.value })} /></Campo>
            <Campo label="Agência"><input className="input" disabled={!podeEditar} value={edit.agencia ?? ''} onChange={(e) => setEdit({ ...edit, agencia: e.target.value })} /></Campo>
            <Campo label="Número da conta"><input className="input" disabled={!podeEditar} value={edit.numero ?? ''} onChange={(e) => setEdit({ ...edit, numero: e.target.value })} /></Campo>
            <Campo label="Chave PIX" className="sm:col-span-2"><input className="input" disabled={!podeEditar} value={edit.pix ?? ''} onChange={(e) => setEdit({ ...edit, pix: e.target.value })} /></Campo>
            <Campo label="Saldo inicial (R$)">
              <div className="flex gap-1">
                <select className="input w-16 shrink-0" disabled={!podeEditar} value={negativo ? '-' : '+'} onChange={(e) => setNegativo(e.target.value === '-')} title="Saldo positivo ou negativo (fatura, cheque especial)"><option value="+">+</option><option value="-">−</option></select>
                <input className="input text-right" inputMode="decimal" disabled={!podeEditar} value={saldoTxt} onChange={(e) => setSaldoTxt(mascaraMoeda(e.target.value))} />
              </div>
            </Campo>
            <Campo label="Data do saldo inicial"><input className="input" type="date" disabled={!podeEditar} value={edit.data_saldo_inicial ?? ''} onChange={(e) => setEdit({ ...edit, data_saldo_inicial: e.target.value || null })} /></Campo>
            <Campo label="Limite (cartão / cheque especial)"><input className="input text-right" inputMode="decimal" disabled={!podeEditar} value={limiteTxt} onChange={(e) => setLimiteTxt(mascaraMoeda(e.target.value))} /></Campo>
            <div />
            <Campo label="Observação" className="sm:col-span-2"><input className="input" disabled={!podeEditar} value={edit.observacao ?? ''} onChange={(e) => setEdit({ ...edit, observacao: e.target.value })} /></Campo>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" disabled={!podeEditar} checked={!!edit.ativa} onChange={(e) => setEdit({ ...edit, ativa: e.target.checked })} /> Ativa (inativa não recebe lançamentos novos)</label>
            <div className="acoes sm:col-span-2 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setEdit(null)}>{podeEditar ? 'Cancelar' : 'Fechar'}</button>
              {podeEditar && <button className="btn-primary" onClick={salvar}>Salvar</button>}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
