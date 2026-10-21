// Baixa de um título (pagamento ou recebimento, total ou parcial): rpc baixar_titulo (0003). O principal abate o
// título; juros/multa e desconto viram lançamentos à parte nos centros de custo de Empresa › Configuração.
import { useState } from 'react'
import { rpc } from '@/lib/dados'
import { fmtData, fmtMoeda, fmtValor, hojeISO, mascaraMoeda, parsePreco, somar } from '@/lib/format'
import { descricaoParcela } from '@/lib/titulos'
import { FORMAS_PAGAMENTO, type ContaFinanceira, type FormaPagamento, type Titulo } from '@/lib/types'
import { Campo, Modal, Opcoes, useToast } from './ui'

export default function BaixaTitulo({ titulo, contas, onFechar }: { titulo: Titulo; contas: ContaFinanceira[]; onFechar: (baixou: boolean) => void }) {
  const { toast } = useToast()
  const saldo = Number(titulo.saldo ?? titulo.valor - titulo.valor_pago)
  const pagar = titulo.tipo === 'PAGAR'
  const [data, setData] = useState(hojeISO())
  const [contaId, setContaId] = useState<number | ''>(titulo.conta_prevista_id ?? contas.find((c) => c.ativa)?.id ?? '')
  const [principalTxt, setPrincipalTxt] = useState(fmtValor(saldo))
  const [jurosTxt, setJurosTxt] = useState('')
  const [descontoTxt, setDescontoTxt] = useState('')
  const [forma, setForma] = useState<FormaPagamento | ''>(titulo.forma_prevista ?? '')
  const [descricao, setDescricao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const principal = parsePreco(principalTxt) ?? 0, juros = parsePreco(jurosTxt) ?? 0, desconto = parsePreco(descontoTxt) ?? 0
  const total = somar([principal, juros, -desconto])

  async function baixar() {
    if (!data) { toast('Informe a data', 'erro'); return }
    if (!contaId) { toast('Escolha a conta', 'erro'); return }
    if (principal <= 0) { toast('Informe o valor', 'erro'); return }
    if (principal > saldo) { toast(`O valor não pode passar do saldo (${fmtMoeda(saldo)})`, 'erro'); return }
    setSalvando(true)
    try {
      await rpc('baixar_titulo', { p_titulo_id: titulo.id, p_data: data, p_conta_id: contaId, p_valor: principal, p_juros: juros, p_desconto: desconto, p_forma: forma || null, p_descricao: descricao.trim() || null })
      toast(principal < saldo ? `Baixa parcial: ficam ${fmtMoeda(somar([saldo, -principal]))} em aberto` : pagar ? 'Título pago' : 'Título recebido')
      onFechar(true)
    } catch (e: any) { toast(e.message, 'erro'); setSalvando(false) }
  }

  return (
    <Modal aberto titulo={`${pagar ? 'Pagar' : 'Receber'}: ${descricaoParcela(titulo.descricao, titulo.parcela, titulo.parcelas)}`} onFechar={() => onFechar(false)} largura="max-w-lg">
      <div className="ficha grid grid-cols-2 gap-2">
        <div className="col-span-2 rounded bg-grafite-50 px-2 py-1 text-xs text-slate-700">
          {titulo.parceiro && <b>{titulo.parceiro} · </b>}vence {fmtData(titulo.vencimento)} · valor {fmtMoeda(titulo.valor)}{titulo.valor_pago > 0 && ` · já ${pagar ? 'pago' : 'recebido'} ${fmtMoeda(titulo.valor_pago)}`} · <b>saldo {fmtMoeda(saldo)}</b>
        </div>
        <Campo label={`Data do ${pagar ? 'pagamento' : 'recebimento'}`}><input className="input" type="date" value={data} onChange={(e) => setData(e.target.value)} /></Campo>
        <Campo label="Conta">
          <select className="input" value={contaId} onChange={(e) => setContaId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">— escolha —</option>{contas.filter((c) => c.ativa).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </Campo>
        <Campo label="Valor do título quitado (R$)"><input className="input text-right font-semibold" inputMode="decimal" autoFocus value={principalTxt} onChange={(e) => setPrincipalTxt(mascaraMoeda(e.target.value))} /></Campo>
        <Campo label="Forma"><Opcoes valor={forma} opcoes={FORMAS_PAGAMENTO} vazio="—" onChange={(v) => setForma(v)} /></Campo>
        <Campo label="Juros / multa (R$)"><input className="input text-right" inputMode="decimal" value={jurosTxt} onChange={(e) => setJurosTxt(mascaraMoeda(e.target.value))} /></Campo>
        <Campo label="Desconto (R$)"><input className="input text-right" inputMode="decimal" value={descontoTxt} onChange={(e) => setDescontoTxt(mascaraMoeda(e.target.value))} /></Campo>
        <Campo label="Descrição (opcional)" className="col-span-2"><input className="input" value={descricao} placeholder={descricaoParcela(titulo.descricao, titulo.parcela, titulo.parcelas)} onChange={(e) => setDescricao(e.target.value)} /></Campo>
        <div className="col-span-2 rounded border border-slate-200 px-2 py-1.5 text-sm">
          Valor {pagar ? 'pago' : 'recebido'} = principal + juros − desconto = <b className="tabular-nums">{fmtMoeda(total)}</b>
          {principal > 0 && principal < saldo && <div className="text-[11px] text-amber-700">Baixa parcial: o título fica com {fmtMoeda(somar([saldo, -principal]))} em aberto.</div>}
        </div>
        <div className="acoes col-span-2 flex justify-end gap-2">
          <button className="btn-secondary" onClick={() => onFechar(false)}>Cancelar</button>
          <button className="btn-primary" disabled={salvando} onClick={baixar}>✓ Confirmar {pagar ? 'pagamento' : 'recebimento'}</button>
        </div>
      </div>
    </Modal>
  )
}
