// Extrato de uma conta (função extrato_conta, 0004): saldo anterior e movimentos confirmados com o saldo acumulado,
// como o extrato do banco — para conferir com o banco antes de fechar o mês. Abre direto com ?conta=<id>.
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { listarContas, rpc } from '@/lib/dados'
import { fmtData, fmtMoeda, fmtValor, limitesDoMes, mesAtual, somar } from '@/lib/format'
import { baixarCsv } from '@/lib/csv'
import { cabecalhoImpressao, escHtml, imprimirHtml } from '@/lib/imprimir'
import { nomeDaEmpresa, useDadosEmpresa } from '@/lib/empresa'
import { TIPOS_CONTA, type ContaFinanceira, type TipoConta, type TipoLancamento } from '@/lib/types'
import { BotaoAtualizar, Campo, Carregando, Titulo, useToast, Vazio } from '@/components/ui'

interface Extrato {
  conta: { id: number; nome: string; tipo: TipoConta }
  saldo_anterior: number
  linhas: { id: number; data: string; tipo: TipoLancamento; valor: number; documento: string | null; descricao: string | null; plano: string | null; parceiro: string | null }[]
}

export default function ExtratoConta() {
  const { toast } = useToast()
  const empresa = useDadosEmpresa()
  const [params, setParams] = useSearchParams()
  const [contas, setContas] = useState<ContaFinanceira[] | null>(null)
  const [contaId, setContaId] = useState<number | null>(Number(params.get('conta')) || null)
  const [de, setDe] = useState(limitesDoMes(mesAtual()).de)
  const [ate, setAte] = useState(limitesDoMes(mesAtual()).ate)
  const [x, setX] = useState<Extrato | null>(null)
  const [carregando, setCarregando] = useState(false)

  useEffect(() => {
    listarContas(false).then((c) => { setContas(c); if (!contaId && c.length) setContaId((c.find((k) => k.ativa && k.tipo === 'CONTA_CORRENTE') ?? c.find((k) => k.ativa) ?? c[0]).id) })
      .catch((e) => toast(e.message, 'erro'))
  }, [])
  const carregar = () => {
    if (!contaId) return
    if (!de || !ate || ate < de) { toast('Período inválido', 'erro'); return }
    setCarregando(true)
    rpc<Extrato>('extrato_conta', { p_conta_id: contaId, p_de: de, p_ate: ate }).then(setX).catch((e) => { toast(e.message, 'erro'); setX(null) }).finally(() => setCarregando(false))
  }
  useEffect(() => { carregar() }, [contaId, de, ate])
  const escolherConta = (id: number) => { setContaId(id); setParams({ conta: String(id) }, { replace: true }) }

  const linhas = useMemo(() => {
    let saldo = Number(x?.saldo_anterior ?? 0)
    return (x?.linhas ?? []).map((l) => { saldo = somar([saldo, l.valor]); return { ...l, valor: Number(l.valor), saldo } })
  }, [x])
  const entradas = somar(linhas.filter((l) => l.valor > 0).map((l) => l.valor))
  const saidas = somar(linhas.filter((l) => l.valor < 0).map((l) => -l.valor))
  const saldoFinal = linhas.length ? linhas[linhas.length - 1].saldo : Number(x?.saldo_anterior ?? 0)
  const titulo = `Extrato · ${x?.conta.nome ?? ''}`
  const detalhe = `${fmtData(de)} a ${fmtData(ate)} · saldo anterior ${fmtMoeda(x?.saldo_anterior)} · saldo final ${fmtMoeda(saldoFinal)}`

  function imprimir() {
    if (!x) return
    const tr = linhas.map((l) => `<tr><td>${fmtData(l.data)}</td><td>${escHtml(l.descricao)}</td><td>${escHtml(l.plano)}</td><td>${escHtml(l.parceiro)}</td><td>${escHtml(l.documento)}</td><td class="num">${l.valor > 0 ? fmtValor(l.valor) : ''}</td><td class="num">${l.valor < 0 ? fmtValor(-l.valor) : ''}</td><td class="num">${fmtValor(l.saldo)}</td></tr>`).join('')
    imprimirHtml(titulo, `${cabecalhoImpressao(nomeDaEmpresa(empresa), titulo, detalhe)}
      <table class="tabela"><thead><tr><th>Data</th><th>Descrição</th><th>Conta do plano</th><th>Cliente/fornecedor</th><th>Documento</th><th class="num">Entrada</th><th class="num">Saída</th><th class="num">Saldo</th></tr></thead>
      <tbody class="zebra"><tr><td colspan="7"><i>Saldo anterior</i></td><td class="num">${fmtValor(x.saldo_anterior)}</td></tr>${tr}</tbody>
      <tfoot><tr><td colspan="5">Totais</td><td class="num">${fmtValor(entradas)}</td><td class="num">${fmtValor(saidas)}</td><td class="num">${fmtValor(saldoFinal)}</td></tr></tfoot></table>`, 'landscape')
  }
  function csv() {
    if (!x) return
    baixarCsv(`extrato-${x.conta.nome}-${de}-a-${ate}`, ['Data', 'Descrição', 'Conta do plano', 'Cliente/fornecedor', 'Documento', 'Entrada', 'Saída', 'Saldo'],
      [['', 'Saldo anterior', '', '', '', '', '', Number(x.saldo_anterior)], ...linhas.map((l) => [fmtData(l.data), l.descricao, l.plano, l.parceiro, l.documento, l.valor > 0 ? l.valor : '', l.valor < 0 ? -l.valor : '', l.saldo])])
  }

  if (!contas) return <Carregando />
  return (
    <div className="flex h-full flex-col">
      <div className="barra">
        <Titulo>Extrato por conta</Titulo>
        <BotaoAtualizar onClick={carregar} ocupado={carregando} />
        <Campo label="Conta">
          <select className="input" value={contaId ?? ''} onChange={(e) => e.target.value && escolherConta(Number(e.target.value))}>
            {!contaId && <option value="">— escolha —</option>}
            {contas.map((c) => <option key={c.id} value={c.id}>{c.nome} · {TIPOS_CONTA[c.tipo]}{c.ativa ? '' : ' (inativa)'}</option>)}
          </select>
        </Campo>
        <Campo label="De"><input className="input" type="date" value={de} onChange={(e) => e.target.value && setDe(e.target.value)} /></Campo>
        <Campo label="Até"><input className="input" type="date" value={ate} onChange={(e) => e.target.value && setAte(e.target.value)} /></Campo>
        <div className="ml-auto flex gap-1.5">
          <button className="btn-secondary" onClick={csv} disabled={!x}>⬇ CSV</button>
          <button className="btn-secondary" onClick={imprimir} disabled={!x}>🖨️</button>
        </div>
      </div>
      {!contas.length ? <Vazio texto="Nenhuma conta cadastrada." /> : !x ? (carregando ? <Carregando /> : <Vazio texto="Escolha a conta." />) : (
        <>
          <div className="mb-1.5 grid grid-cols-2 gap-1.5 text-xs lg:grid-cols-4">
            <div className="card px-3 py-1.5 border-l-4 border-l-grafite-700"><span className="text-slate-500">Saldo anterior </span><b className="num">{fmtMoeda(x.saldo_anterior)}</b></div>
            <div className="card px-3 py-1.5 border-l-4 border-l-emerald-600"><span className="text-slate-500">Entradas </span><b className="num">{fmtMoeda(entradas)}</b></div>
            <div className="card px-3 py-1.5 border-l-4 border-l-red-600"><span className="text-slate-500">Saídas </span><b className="num">{fmtMoeda(saidas)}</b></div>
            <div className="card px-3 py-1.5 border-l-4 border-l-laranja-500"><span className="text-slate-500">Saldo final </span><b className={`num ${saldoFinal < 0 ? 'text-red-700' : ''}`}>{fmtMoeda(saldoFinal)}</b></div>
          </div>
          <div className="card flex-1 min-h-0 overflow-auto">
            <table className="tabela">
              <thead><tr><th>Data</th><th>Descrição</th><th>Conta do plano</th><th>Cliente/fornecedor</th><th>Documento</th><th className="num">Entrada</th><th className="num">Saída</th><th className="num">Saldo</th></tr></thead>
              <tbody>
                <tr><td></td><td colSpan={6} className="italic text-slate-500">Saldo anterior em {fmtData(de)}</td><td className="num font-semibold">{fmtValor(x.saldo_anterior)}</td></tr>
                {linhas.map((l) => (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap">{fmtData(l.data)}</td>
                    <td className="max-w-[320px] truncate" title={l.descricao ?? ''}>{l.descricao}</td>
                    <td>{l.plano ?? (l.tipo === 'TRANSFERENCIA' ? <span className="text-slate-400">transferência</span> : '')}</td>
                    <td>{l.parceiro}</td><td>{l.documento}</td>
                    <td className="num text-emerald-700">{l.valor > 0 ? fmtValor(l.valor) : ''}</td>
                    <td className="num text-red-700">{l.valor < 0 ? fmtValor(-l.valor) : ''}</td>
                    <td className={`num font-semibold ${l.saldo < 0 ? 'text-red-700' : ''}`}>{fmtValor(l.saldo)}</td>
                  </tr>
                ))}
                {linhas.length === 0 && <tr><td colSpan={8} className="py-4 text-center text-slate-400">Nenhum movimento confirmado no período.</td></tr>}
              </tbody>
              <tfoot><tr><td colSpan={5}>Totais do período</td><td className="num">{fmtValor(entradas)}</td><td className="num">{fmtValor(saidas)}</td><td className="num">{fmtValor(saldoFinal)}</td></tr></tfoot>
            </table>
          </div>
          <p className="mt-1.5 text-[11px] text-slate-500">Só lançamentos confirmados; as linhas do extrato ainda pendentes de classificação ficam de fora até serem conciliadas.</p>
        </>
      )}
    </div>
  )
}
