// Lançamentos: o que entrou e saiu das contas no mês (entradas, saídas e transferências), inclusive as baixas de títulos
// e as linhas do extrato ainda pendentes de conciliação.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { listarCentros, listarContas, listarParceiros, listarPlano, todas, type ParceiroLista } from '@/lib/dados'
import { fmtData, fmtMoeda, fmtValor, hojeISO, limitesDoMes, mesAtual, nomeMes, normalizar, somar, somarMes } from '@/lib/format'
import { cabecalhoImpressao, escHtml, imprimirHtml } from '@/lib/imprimir'
import { baixarCsv } from '@/lib/csv'
import { nomeDaEmpresa, useDadosEmpresa } from '@/lib/empresa'
import { useAuth } from '@/lib/auth'
import { contemCodigo } from '@/lib/planoContas'
import { descricaoParcela } from '@/lib/titulos'
import { FORMAS_PAGAMENTO, TIPOS_LANCAMENTO, ehFinanceiro, ehOperador, type CentroCusto, type ContaFinanceira, type Lancamento, type PlanoConta, type TipoLancamento } from '@/lib/types'
import { BotaoAtualizar, Campo, Carregando, Chip, Opcoes, Titulo, useToast, Vazio } from '@/components/ui'
import FormLancamento from '@/components/FormLancamento'
import NovoPlanoConta from '@/components/NovoPlanoConta'

const COR_TIPO: Record<TipoLancamento, 'verde' | 'vermelho' | 'azul'> = { ENTRADA: 'verde', SAIDA: 'vermelho', TRANSFERENCIA: 'azul' }
/** data sugerida para lançar no mês: hoje, se for o mês corrente; senão o último dia (passado) ou o primeiro (futuro) */
const dataDoMes = (mes: string) => {
  const hoje = hojeISO()
  if (hoje.startsWith(mes)) return hoje
  const { de, ate } = limitesDoMes(mes)
  return mes < hoje ? ate : de
}

export default function Lancamentos() {
  const empresa = useDadosEmpresa()
  const { perfil } = useAuth()
  const { toast } = useToast()
  const [lista, setLista] = useState<Lancamento[] | null>(null)
  const [planos, setPlanos] = useState<PlanoConta[]>([])
  const [centros, setCentros] = useState<CentroCusto[]>([])
  const [contas, setContas] = useState<ContaFinanceira[]>([])
  const [parceiros, setParceiros] = useState<ParceiroLista[]>([])
  const [mes, setMes] = useState(mesAtual())
  const [tipo, setTipo] = useState<'' | TipoLancamento>('')
  const [planoF, setPlanoF] = useState('')
  const [centroF, setCentroF] = useState('')
  const [contaF, setContaF] = useState('')
  const [texto, setTexto] = useState('')
  const [soPendentes, setSoPendentes] = useState(false)
  const [edit, setEdit] = useState<Partial<Lancamento> | null>(null)
  const [novoPlano, setNovoPlano] = useState(false)

  async function carregar() {
    try {
      const { de, ate } = limitesDoMes(mes)
      setLista(await todas<Lancamento>((a, b) => supabase.from('v_lancamento').select('*').gte('data', de).lte('data', ate)
        .order('data', { ascending: false }).order('id', { ascending: false }).range(a, b)))
    } catch (e: any) { toast(e.message, 'erro'); setLista([]) }
  }
  const carregarPlanos = () => listarPlano(false).then(setPlanos).catch((e) => toast(e.message, 'erro'))
  const carregarParceiros = () => listarParceiros().then(setParceiros).catch(() => {})
  const carregarCadastros = () => Promise.all([
    carregarPlanos(),
    listarCentros(false).then(setCentros).catch(() => {}),
    listarContas(false).then(setContas).catch((e) => toast(e.message, 'erro')),
    carregarParceiros(),
  ])
  useEffect(() => { carregar() }, [mes])
  useEffect(() => { carregarCadastros() }, [])

  const visiveis = useMemo(() => {
    const t = normalizar(texto.trim())
    const plano = planos.find((c) => String(c.id) === planoF)
    return (lista ?? []).filter((l) => (!soPendentes || l.situacao === 'PENDENTE') && (!tipo || l.tipo === tipo)
      && (!plano || (l.plano_codigo != null && contemCodigo(plano, l.plano_codigo)))
      && (!centroF || String(l.centro_custo_id ?? '') === centroF)
      && (!contaF || String(l.conta_id) === contaF || String(l.conta_destino_id) === contaF)
      && (!t || normalizar(`${l.descricao ?? ''} ${l.parceiro ?? ''} ${l.plano ?? ''} ${l.documento ?? ''} ${l.extrato_descricao ?? ''}`).includes(t)))
  }, [lista, planos, tipo, planoF, centroF, contaF, texto, soPendentes])
  const pendentes = (lista ?? []).filter((l) => l.situacao === 'PENDENTE').length
  const soma = (tp: TipoLancamento) => somar(visiveis.filter((l) => l.tipo === tp && l.situacao === 'CONFIRMADO').map((l) => l.valor))
  const entradas = soma('ENTRADA'), saidas = soma('SAIDA')
  const podeEscrever = ehOperador(perfil)

  const rotuloClass = (l: Lancamento) => l.plano ?? (l.tipo === 'TRANSFERENCIA' ? `→ ${l.conta_destino ?? ''}` : '')
  function imprimir() {
    const linhas = visiveis.map((l) => `<tr><td>${fmtData(l.data)}</td><td>${TIPOS_LANCAMENTO[l.tipo].split(' ')[0]}</td><td>${escHtml(rotuloClass(l))}</td><td>${escHtml(l.parceiro)}</td><td>${escHtml(l.conta)}</td><td>${escHtml(l.descricao)}</td><td>${escHtml(l.documento)}</td><td class="num">${l.tipo === 'SAIDA' ? '-' : ''}${fmtValor(l.valor)}</td></tr>`).join('')
    imprimirHtml(`Lançamentos ${mes}`, `${cabecalhoImpressao(nomeDaEmpresa(empresa), 'Lançamentos', nomeMes(mes))}
      <div style="font-size:9pt;margin-bottom:6px">Entradas ${fmtMoeda(entradas)} · Saídas ${fmtMoeda(saidas)} · Resultado ${fmtMoeda(entradas - saidas)} · ${visiveis.length} lançamento(s)${pendentes ? ` · ${pendentes} pendente(s) fora das somas` : ''}</div>
      <table class="tabela"><thead><tr><th>Data</th><th>Tipo</th><th>Conta do plano</th><th>Cliente/fornecedor</th><th>Conta</th><th>Descrição</th><th>Documento</th><th class="num">Valor</th></tr></thead><tbody class="zebra">${linhas}</tbody></table>`, 'landscape')
  }
  function exportar() {
    baixarCsv(`lancamentos-${mes}`, ['Data', 'Competência', 'Tipo', 'Situação', 'Grupo', 'Conta do plano', 'Centro de custo', 'Cliente/fornecedor', 'Conta', 'Conta destino', 'Forma', 'Descrição', 'Documento', 'Valor'],
      visiveis.map((l) => [fmtData(l.data), l.competencia?.slice(0, 7), TIPOS_LANCAMENTO[l.tipo], l.situacao === 'PENDENTE' ? 'Pendente' : 'Confirmado', l.plano_raiz, l.plano, l.centro_custo, l.parceiro,
        l.conta, l.conta_destino, l.forma ? FORMAS_PAGAMENTO[l.forma] : '', l.descricao, l.documento, l.tipo === 'SAIDA' ? -l.valor : l.valor]))
  }

  if (!lista) return <Carregando />
  return (
    <div className="flex h-full flex-col">
      <div className="barra">
        <Titulo>Lançamentos</Titulo>
        <BotaoAtualizar onClick={() => { carregar(); carregarCadastros() }} />
        <div className="flex items-center gap-1">
          <button className="btn-secondary py-0.5" onClick={() => setMes(somarMes(mes, -1))}>◀</button>
          <input className="input" type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} />
          <button className="btn-secondary py-0.5" onClick={() => setMes(somarMes(mes, 1))}>▶</button>
        </div>
        <Campo label="Tipo"><Opcoes valor={tipo} opcoes={TIPOS_LANCAMENTO} onChange={setTipo} vazio="Todos" /></Campo>
        <Campo label="Conta do plano">
          <select className="input" value={planoF} onChange={(e) => setPlanoF(e.target.value)} title="Conta do plano (o grupo inclui as contas abaixo dele)">
            <option value="">Todas</option>{planos.map((c) => <option key={c.id} value={c.id}>{c.tipo === 'ENTRADA' ? '▲' : '▼'} {'  '.repeat(c.nivel - 1)}{c.nome}</option>)}
          </select>
        </Campo>
        {centros.length > 0 && (
          <Campo label="Centro">
            <select className="input" value={centroF} onChange={(e) => setCentroF(e.target.value)}>
              <option value="">Todos</option>{centros.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </Campo>
        )}
        <Campo label="Conta">
          <select className="input" value={contaF} onChange={(e) => setContaF(e.target.value)}>
            <option value="">Todas</option>{contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </Campo>
        <Campo label="Buscar"><input className="input" type="text" placeholder="descrição, cliente, documento…" value={texto} onChange={(e) => setTexto(e.target.value)} /></Campo>
        <button type="button" className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${soPendentes ? 'bg-amber-500 text-white' : pendentes ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500'}`}
          onClick={() => setSoPendentes(!soPendentes)} title="Linhas do extrato que aguardam classificação ou conciliação (fora de saldos e relatórios)">
          Pendentes de conciliação: {pendentes}
        </button>
        {pendentes > 0 && podeEscrever && <Link className="text-[11px] font-semibold text-laranja-700 underline" to="/financeiro/conciliacao">conciliar</Link>}
        <div className="ml-auto flex gap-1.5">
          {ehFinanceiro(perfil) && <button className="btn-secondary" title="Incluir conta no plano de contas" onClick={() => setNovoPlano(true)}>+ Conta do plano</button>}
          <button className="btn-secondary" title="Imprimir" onClick={imprimir}>🖨️</button>
          <button className="btn-secondary" title="Exportar para planilha (CSV)" onClick={exportar}>⬇️ CSV</button>
          {podeEscrever && <button className="btn-primary" onClick={() => setEdit({ tipo: 'SAIDA', data: dataDoMes(mes), conta_id: contas.find((c) => c.ativa)?.id })}>+ Novo lançamento</button>}
        </div>
      </div>
      <div className="mb-1.5 grid grid-cols-3 gap-1.5 text-xs">
        <div className="card px-3 py-1.5 border-l-4 border-l-emerald-600"><span className="text-slate-500">Entradas </span><b className="tabular-nums">{fmtMoeda(entradas)}</b></div>
        <div className="card px-3 py-1.5 border-l-4 border-l-red-600"><span className="text-slate-500">Saídas </span><b className="tabular-nums">{fmtMoeda(saidas)}</b></div>
        <div className="card px-3 py-1.5 border-l-4 border-l-grafite-700"><span className="text-slate-500">Resultado </span><b className={`tabular-nums ${entradas - saidas < 0 ? 'text-red-700' : ''}`}>{fmtMoeda(entradas - saidas)}</b><span className="text-slate-400"> · {visiveis.length} lanç.</span></div>
      </div>
      <div className="card flex-1 min-h-0 overflow-auto">
        {visiveis.length === 0 ? <Vazio texto="Nenhum lançamento no período" /> : (
          <table className="tabela">
            <thead><tr><th>Data</th><th>Tipo</th><th>Conta do plano</th><th>Cliente/fornecedor</th><th>Conta</th><th>Descrição</th><th className="num">Valor</th></tr></thead>
            <tbody>
              {visiveis.map((l) => (
                <tr key={l.id} className="cursor-pointer hover:bg-grafite-50" onClick={() => setEdit(l)}>
                  <td className="whitespace-nowrap">{fmtData(l.data)}</td>
                  <td><Chip cor={COR_TIPO[l.tipo]}>{TIPOS_LANCAMENTO[l.tipo].split(' ')[0]}</Chip></td>
                  <td>{l.plano ?? (l.conta_destino ? <span className="text-slate-500">→ {l.conta_destino}</span> : '')}{l.plano_raiz && <span className="ml-1 text-[10px] text-slate-400">{l.plano_raiz}</span>}</td>
                  <td>{l.parceiro}</td><td>{l.conta}</td>
                  <td className="max-w-[320px] truncate" title={l.extrato_descricao ?? l.descricao ?? ''}>
                    {l.situacao === 'PENDENTE' && <Chip cor="amarelo">pendente</Chip>}{' '}
                    {l.titulo_id ? descricaoParcela(l.descricao ?? '', l.parcela, l.parcelas) : l.descricao}
                    {l.titulo_id && <span className="ml-1 text-[10px] text-sky-700" title="Baixa de título">({l.titulo_papel === 'PRINCIPAL' ? 'baixa' : l.titulo_papel === 'JUROS' ? 'juros' : 'desconto'})</span>}
                    {!!l.anexos && <span className="ml-1 text-[10px] text-slate-500" title={`${l.anexos} documento(s)`}>📎{l.anexos > 1 ? l.anexos : ''}</span>}
                  </td>
                  <td className={`num font-semibold ${l.tipo === 'SAIDA' ? 'text-red-700' : l.tipo === 'ENTRADA' ? 'text-emerald-700' : ''} ${l.situacao === 'PENDENTE' ? 'opacity-60' : ''}`}>{l.tipo === 'SAIDA' ? '−' : ''}{fmtValor(l.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {novoPlano && <NovoPlanoConta lista={planos} onFechar={(criada) => { setNovoPlano(false); if (criada) carregarPlanos() }} />}
      {edit && <FormLancamento inicial={edit} planos={planos} centros={centros} contas={contas} parceiros={parceiros}
        onPlanos={carregarPlanos} onParceiros={carregarParceiros} onFechar={(mudou) => { setEdit(null); if (mudou) carregar() }} />}
    </div>
  )
}
