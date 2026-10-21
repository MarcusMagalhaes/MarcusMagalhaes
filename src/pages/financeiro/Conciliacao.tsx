// Conciliação bancária: importar o extrato do banco (OFX ou CSV) e tratar as linhas pendentes — conciliar com um título
// em aberto (a linha vira a baixa; diferença a maior vira juros), classificar (conta do plano, centro, cliente/fornecedor)
// e confirmar, ou excluir. Porte do ImportarExtrato do Luminexus (0008) com a conciliação de títulos do Finanway (0003).
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase, ok } from '@/lib/supabase'
import { listarCentros, listarContas, listarParceiros, listarPlano, rpc, todas, type ParceiroLista } from '@/lib/dados'
import { lerArquivoTexto, lerExtrato, type LinhaExtrato } from '@/lib/extrato'
import { fmtData, fmtDataHora, fmtMoeda, fmtValor, normalizar, somar } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { ehFinanceiro, type CentroCusto, type ContaFinanceira, type Lancamento, type PlanoConta } from '@/lib/types'
import { Abas, BotaoAtualizar, Campo, Carregando, Chip, Confirmar, Modal, Titulo, useToast, Vazio } from '@/components/ui'
import ComboParceiro from '@/components/ComboParceiro'
import OpcoesPlano from '@/components/OpcoesPlano'
import FormLancamento from '@/components/FormLancamento'

interface Importacao { id: number; conta_id: number; arquivo_nome: string; formato: string; periodo_de: string | null; periodo_ate: string | null; linhas: number; importadas: number; duplicadas: number; criado_em: string }
type Previa = LinhaExtrato & { duplicada: boolean; marcada: boolean; plano_conta_id: number | null; parceiro_id: number | null; centro_custo_id: number | null; sugerida: boolean }
interface Candidato { titulo_id: number; descricao: string; parceiro: string | null; vencimento: string; saldo: number; diferenca: number; dias: number }
interface Cadastros { planos: PlanoConta[]; centros: CentroCusto[]; contas: ContaFinanceira[]; parceiros: ParceiroLista[] }

export default function Conciliacao() {
  const { toast } = useToast()
  const [aba, setAba] = useState<'importar' | 'pendentes'>('pendentes')
  const [cad, setCad] = useState<Cadastros | null>(null)
  const [qtdPendentes, setQtdPendentes] = useState<number | null>(null)
  const carregarCadastros = () => Promise.all([listarPlano(false), listarCentros(false), listarContas(false), listarParceiros()])
    .then(([planos, centros, contas, parceiros]) => setCad({ planos, centros, contas, parceiros })).catch((e) => toast(e.message, 'erro'))
  const contarPendentes = () => Promise.resolve(supabase.from('lancamento').select('id', { count: 'exact', head: true }).eq('situacao', 'PENDENTE'))
    .then((r) => setQtdPendentes(r.count ?? 0)).catch(() => {})
  useEffect(() => { carregarCadastros(); contarPendentes() }, [])
  useEffect(() => { if (qtdPendentes === 0) setAba('importar') }, [qtdPendentes === 0])

  if (!cad) return <Carregando />
  return (
    <div className="flex h-full flex-col">
      <div className="barra">
        <Titulo>Conciliação bancária</Titulo>
        <Abas atual={aba} onChange={setAba} abas={[{ chave: 'importar', rotulo: '🏦 Importar extrato' }, { chave: 'pendentes', rotulo: `⏳ Pendentes${qtdPendentes ? ` (${qtdPendentes})` : ''}` }]} />
        <span className="text-[11px] text-slate-500">Baixe no internet banking o extrato em OFX (ou CSV) → importe aqui → em Pendentes, concilie cada linha com a conta a pagar/receber ou classifique e confirme.</span>
      </div>
      {aba === 'importar'
        ? <Importar cad={cad} onImportou={() => { contarPendentes(); setAba('pendentes') }} />
        : <Pendentes cad={cad} onCadastros={carregarCadastros} onMudou={contarPendentes} />}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Importar extrato
// ---------------------------------------------------------------------------------------------------------------
function Importar({ cad, onImportou }: { cad: Cadastros; onImportou: () => void }) {
  const { toast } = useToast()
  const contas = cad.contas.filter((c) => c.ativa)
  const [historico, setHistorico] = useState<Importacao[] | null>(null)
  const [contaId, setContaId] = useState<number | ''>((contas.find((x) => x.tipo === 'CONTA_CORRENTE') ?? contas[0])?.id ?? '')
  const [arquivo, setArquivo] = useState<{ nome: string; formato: 'OFX' | 'CSV' } | null>(null)
  const [previa, setPrevia] = useState<Previa[]>([])
  const [importando, setImportando] = useState(false)
  const entrada = useRef<HTMLInputElement>(null)
  const carregarHistorico = () => Promise.resolve(supabase.from('importacao_extrato').select('*').order('criado_em', { ascending: false }).limit(50))
    .then((r) => setHistorico(ok(r) as Importacao[])).catch((e) => toast(e.message, 'erro'))
  useEffect(() => { carregarHistorico() }, [])

  async function escolhido(f: File | undefined) {
    if (!f || !contaId) { if (!contaId) toast('Escolha a conta primeiro', 'erro'); return }
    try {
      const texto = await lerArquivoTexto(f)
      const { formato, linhas } = lerExtrato(f.name, texto)
      if (!linhas.length) { toast('Nenhuma transação reconhecida no arquivo. Use o OFX do banco ou um CSV com data, descrição e valor.', 'erro'); return }
      // duplicadas: já existem na conta
      const ids = linhas.map((l) => l.extrato_id)
      const existentes = new Set<string>()
      for (let i = 0; i < ids.length; i += 200) {
        const r = ok(await supabase.from('lancamento').select('extrato_id').eq('conta_id', contaId).in('extrato_id', ids.slice(i, i + 200))) as { extrato_id: string }[]
        r.forEach((x) => existentes.add(x.extrato_id))
      }
      // sugestões pelo histórico (mesma descrição já classificada antes)
      const sug = new Map<string, { plano_conta_id: number | null; parceiro_id: number | null; centro_custo_id: number | null }>()
      try {
        const s = await rpc<{ descricao: string; plano_conta_id: number | null; parceiro_id: number | null; centro_custo_id: number | null }[]>('sugerir_classificacao', { p_descricoes: Array.from(new Set(linhas.map((l) => l.descricao))) })
        s.forEach((x) => sug.set(x.descricao, x))
      } catch { /* sem sugestão */ }
      setArquivo({ nome: f.name, formato })
      setPrevia(linhas.map((l) => {
        const dup = existentes.has(l.extrato_id); const s = sug.get(l.descricao)
        return { ...l, duplicada: dup, marcada: !dup, plano_conta_id: s?.plano_conta_id ?? null, parceiro_id: s?.parceiro_id ?? null, centro_custo_id: s?.centro_custo_id ?? null, sugerida: !!s?.plano_conta_id }
      }))
      toast(`${linhas.length} transações lidas (${formato})${existentes.size ? ` · ${existentes.size} já importadas` : ''}`, 'info')
    } catch (e: any) { toast(e.message, 'erro') }
    if (entrada.current) entrada.current.value = ''
  }
  async function importar() {
    const sel = previa.filter((p) => p.marcada && !p.duplicada)
    if (!sel.length || !contaId || !arquivo) return
    setImportando(true)
    try {
      const r = await rpc<{ importadas: number; duplicadas: number }>('importar_extrato', {
        p_conta_id: contaId, p_arquivo: arquivo.nome, p_formato: arquivo.formato,
        p_linhas: sel.map((p) => ({ extrato_id: p.extrato_id, data: p.data, valor: p.valor, descricao: p.descricao, plano_conta_id: p.plano_conta_id, parceiro_id: p.parceiro_id, centro_custo_id: p.centro_custo_id })),
      })
      toast(`${r.importadas} linha(s) importadas como pendentes${r.duplicadas ? ` · ${r.duplicadas} duplicadas ignoradas` : ''}. Concilie ou confirme em Pendentes.`)
      setPrevia([]); setArquivo(null); carregarHistorico(); onImportou()
    } catch (e: any) { toast(e.message, 'erro') } finally { setImportando(false) }
  }
  const set = (i: number, patch: Partial<Previa>) => setPrevia((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  const totais = useMemo(() => {
    const s = previa.filter((p) => p.marcada && !p.duplicada)
    return { n: s.length, ent: somar(s.filter((p) => p.valor > 0).map((p) => p.valor)), sai: somar(s.filter((p) => p.valor < 0).map((p) => -p.valor)) }
  }, [previa])
  const nomeConta = (id: number) => cad.contas.find((c) => c.id === id)?.nome ?? id

  if (!historico) return <Carregando />
  return (
    <>
      <div className="barra">
        <Campo label="Conta">
          <select className="input" value={contaId} disabled={previa.length > 0} onChange={(e) => setContaId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">— escolha —</option>{contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </Campo>
        <button className="btn-primary" disabled={!contaId || previa.length > 0} onClick={() => entrada.current?.click()}>📎 Escolher arquivo (OFX ou CSV)</button>
        <input ref={entrada} type="file" accept=".ofx,.csv,.txt,text/csv,text/plain,application/x-ofx" className="hidden" onChange={(e) => escolhido(e.target.files?.[0])} />
        {arquivo && <span className="text-[11px] text-slate-500">{arquivo.nome} · {arquivo.formato} · {previa.length} linhas</span>}
        {previa.length > 0 && (
          <div className="ml-auto flex items-center gap-2 text-xs">
            <span>{totais.n} selecionadas · entradas <b className="text-emerald-700">{fmtValor(totais.ent)}</b> · saídas <b className="text-red-700">{fmtValor(totais.sai)}</b></span>
            <button className="btn-primary" disabled={!totais.n || importando} onClick={importar}>{importando ? 'Importando…' : `Importar ${totais.n} como pendentes`}</button>
            <button className="btn-secondary" onClick={() => { setPrevia([]); setArquivo(null) }}>Descartar</button>
          </div>
        )}
      </div>
      {previa.length > 0 ? (
        <div className="card flex-1 min-h-0 overflow-auto">
          <table className="tabela">
            <thead><tr>
              <th><input type="checkbox" checked={previa.every((p) => p.marcada || p.duplicada)} onChange={(e) => setPrevia((ps) => ps.map((p) => ({ ...p, marcada: p.duplicada ? false : e.target.checked })))} /></th>
              <th>Data</th><th>Descrição no extrato</th><th className="num">Valor</th><th>Conta do plano</th><th>Cliente / fornecedor</th><th>Centro de custo</th><th></th>
            </tr></thead>
            <tbody>
              {previa.map((p, i) => (
                <tr key={p.extrato_id + i} className={p.duplicada ? 'opacity-50' : ''}>
                  <td><input type="checkbox" disabled={p.duplicada} checked={p.marcada && !p.duplicada} onChange={(e) => set(i, { marcada: e.target.checked })} /></td>
                  <td className="whitespace-nowrap">{fmtData(p.data)}</td>
                  <td className="max-w-[320px] truncate" title={p.descricao}>{p.descricao}</td>
                  <td className={`num font-semibold ${p.valor < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{p.valor < 0 ? '−' : ''}{fmtValor(Math.abs(p.valor))}</td>
                  <td>
                    <select className={`input py-0.5 text-[11px] ${p.sugerida ? 'bg-emerald-50' : 'bg-yellow-50'}`} disabled={p.duplicada} value={p.plano_conta_id ?? ''} onChange={(e) => set(i, { plano_conta_id: e.target.value ? Number(e.target.value) : null, sugerida: false })}>
                      <option value="">A classificar</option>
                      <OpcoesPlano planos={cad.planos} filtro={(c) => c.tipo === (p.valor > 0 ? 'ENTRADA' : 'SAIDA')} atual={p.plano_conta_id} />
                    </select>
                  </td>
                  <td className="min-w-[170px]">{!p.duplicada && <ComboParceiro parceiros={cad.parceiros} valor={p.parceiro_id} tipo={p.valor > 0 ? 'CLIENTE' : 'FORNECEDOR'} className="input py-0.5 text-[11px] bg-yellow-50" onChange={(id) => set(i, { parceiro_id: id })} placeholder="—" />}</td>
                  <td>
                    <select className="input py-0.5 text-[11px] bg-yellow-50" disabled={p.duplicada} value={p.centro_custo_id ?? ''} onChange={(e) => set(i, { centro_custo_id: e.target.value ? Number(e.target.value) : null })}>
                      <option value="">—</option>{cad.centros.filter((c) => c.ativo).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                    </select>
                  </td>
                  <td>{p.duplicada ? <Chip cor="cinza">já importada</Chip> : p.sugerida ? <Chip cor="verde" title="Classificação sugerida pelo histórico">sugerida</Chip> : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card flex-1 min-h-0 overflow-auto">
          <div className="border-b border-slate-200 p-3 text-xs text-slate-600">
            <b>Como funciona:</b> baixe o extrato no internet banking em <b>OFX</b> (Money/Quicken) ou CSV, escolha a conta e o arquivo. Cada transação entra
            como <b>pendente</b>: fica fora dos saldos e relatórios até ser conciliada com uma conta a pagar/receber ou classificada e confirmada na aba
            Pendentes. Transações já importadas são reconhecidas e não duplicam; a classificação é sugerida quando a mesma descrição já foi classificada antes.
          </div>
          {historico.length === 0 ? <Vazio texto="Nenhuma importação ainda." /> : (
            <table className="tabela">
              <thead><tr><th>Quando</th><th>Conta</th><th>Arquivo</th><th>Período</th><th className="num">Linhas</th><th className="num">Importadas</th><th className="num">Duplicadas</th></tr></thead>
              <tbody>
                {historico.map((h) => (
                  <tr key={h.id}><td className="whitespace-nowrap">{fmtDataHora(h.criado_em)}</td><td>{nomeConta(h.conta_id)}</td><td>{h.arquivo_nome} <span className="text-slate-400">({h.formato})</span></td>
                    <td className="whitespace-nowrap">{fmtData(h.periodo_de)} a {fmtData(h.periodo_ate)}</td><td className="num">{h.linhas}</td><td className="num">{h.importadas}</td><td className="num">{h.duplicadas}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Pendentes: conciliar com título, classificar e confirmar, excluir
// ---------------------------------------------------------------------------------------------------------------
function Pendentes({ cad, onCadastros, onMudou }: { cad: Cadastros; onCadastros: () => Promise<unknown>; onMudou: () => void }) {
  const { toast } = useToast()
  const { perfil } = useAuth()
  const [lista, setLista] = useState<Lancamento[] | null>(null)
  const [contaF, setContaF] = useState('')
  const [texto, setTexto] = useState('')
  const [marcados, setMarcados] = useState<Set<number>>(new Set())
  const [conciliar, setConciliar] = useState<Lancamento | null>(null)
  const [classificar, setClassificar] = useState<Lancamento | null>(null)
  const [lote, setLote] = useState(false)
  const [excluir, setExcluir] = useState<Lancamento | null>(null)
  async function carregar() {
    try {
      setLista(await todas<Lancamento>((a, b) => supabase.from('v_lancamento').select('*').eq('situacao', 'PENDENTE').order('data').order('id').range(a, b)))
    } catch (e: any) { toast(e.message, 'erro'); setLista([]) }
  }
  useEffect(() => { carregar() }, [])
  const mudou = () => { setMarcados(new Set()); carregar(); onMudou() }
  const visiveis = useMemo(() => {
    const t = normalizar(texto.trim())
    return (lista ?? []).filter((l) => (!contaF || String(l.conta_id) === contaF) && (!t || normalizar(`${l.extrato_descricao ?? ''} ${l.descricao ?? ''} ${l.parceiro ?? ''}`).includes(t)))
  }, [lista, contaF, texto])
  const marcadosLista = visiveis.filter((l) => marcados.has(l.id))
  const tiposMarcados = new Set(marcadosLista.map((l) => l.tipo))
  async function confirmarExcluir() {
    if (!excluir) return
    const l = excluir; setExcluir(null)
    try { ok(await supabase.from('lancamento').delete().eq('id', l.id)); toast('Linha do extrato excluída'); mudou() } catch (e: any) { toast(e.message, 'erro') }
  }
  const alternar = (id: number) => setMarcados((m) => { const s = new Set(m); if (s.has(id)) s.delete(id); else s.add(id); return s })

  if (!lista) return <Carregando />
  return (
    <>
      <div className="barra">
        <BotaoAtualizar onClick={() => { carregar(); onMudou() }} />
        <Campo label="Conta">
          <select className="input" value={contaF} onChange={(e) => setContaF(e.target.value)}>
            <option value="">Todas</option>{cad.contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </Campo>
        <Campo label="Buscar"><input className="input" type="text" placeholder="texto do extrato…" value={texto} onChange={(e) => setTexto(e.target.value)} /></Campo>
        <span className="text-[11px] text-slate-500">{visiveis.length} pendente(s) · entradas {fmtMoeda(somar(visiveis.filter((l) => l.tipo === 'ENTRADA').map((l) => l.valor)))} · saídas {fmtMoeda(somar(visiveis.filter((l) => l.tipo === 'SAIDA').map((l) => l.valor)))}</span>
        {marcadosLista.length > 0 && (
          <button className="btn-accent ml-auto" disabled={tiposMarcados.size > 1} title={tiposMarcados.size > 1 ? 'Selecione só entradas ou só saídas' : ''} onClick={() => setLote(true)}>
            Classificar {marcadosLista.length} selecionada(s)
          </button>
        )}
      </div>
      <div className="card flex-1 min-h-0 overflow-auto">
        {visiveis.length === 0 ? <Vazio texto="Nenhuma linha do extrato pendente. Tudo conciliado ✓" /> : (
          <table className="tabela">
            <thead><tr>
              <th className="w-6"><input type="checkbox" checked={visiveis.length > 0 && marcadosLista.length === visiveis.length} onChange={(e) => setMarcados(e.target.checked ? new Set(visiveis.map((l) => l.id)) : new Set())} /></th>
              <th>Data</th><th>Conta</th><th>No extrato</th><th>Classificação atual</th><th className="num">Valor</th><th></th>
            </tr></thead>
            <tbody>
              {visiveis.map((l) => (
                <tr key={l.id}>
                  <td><input type="checkbox" checked={marcados.has(l.id)} onChange={() => alternar(l.id)} /></td>
                  <td className="whitespace-nowrap">{fmtData(l.data)}</td>
                  <td>{l.conta}</td>
                  <td className="max-w-[320px] truncate" title={l.extrato_descricao ?? ''}>{l.extrato_descricao ?? l.descricao}</td>
                  <td className="max-w-[200px] truncate">{l.plano === 'A classificar' ? <span className="text-amber-700">A classificar</span> : l.plano}{l.parceiro && <span className="ml-1 text-[10px] text-slate-400">{l.parceiro}</span>}</td>
                  <td className={`num font-semibold ${l.tipo === 'SAIDA' ? 'text-red-700' : 'text-emerald-700'}`}>{l.tipo === 'SAIDA' ? '−' : ''}{fmtValor(l.valor)}</td>
                  <td className="whitespace-nowrap text-right">
                    <button className="btn-primary mr-1 py-0 text-[11px]" title={`Quitar uma conta a ${l.tipo === 'SAIDA' ? 'pagar' : 'receber'} com esta linha`} onClick={() => setConciliar(l)}>🔗 Conciliar</button>
                    <button className="btn-secondary mr-1 py-0 text-[11px]" onClick={() => setClassificar(l)}>Classificar</button>
                    {ehFinanceiro(perfil) && <button className="px-1 text-red-600" title="Excluir a linha" onClick={() => setExcluir(l)}>✕</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {conciliar && <ConciliarTitulo lancamento={conciliar} onFechar={(feito) => { setConciliar(null); if (feito) mudou() }} />}
      {classificar && <FormLancamento inicial={classificar} planos={cad.planos} centros={cad.centros} contas={cad.contas} parceiros={cad.parceiros}
        onPlanos={onCadastros} onParceiros={onCadastros} onFechar={(m) => { setClassificar(null); if (m) mudou() }} />}
      {lote && <ClassificarLote linhas={marcadosLista} cad={cad} onFechar={(m) => { setLote(false); if (m) mudou() }} />}
      <Confirmar aberto={!!excluir} perigo titulo="Excluir linha do extrato" texto={`Excluir a linha de ${fmtMoeda(excluir?.valor)} de ${fmtData(excluir?.data)}? Se o arquivo for importado de novo, ela volta.`}
        onNao={() => setExcluir(null)} onSim={confirmarExcluir} />
    </>
  )
}

/** escolhe o título em aberto que a linha do extrato quita (titulos_para_conciliar → conciliar_titulo) */
function ConciliarTitulo({ lancamento: l, onFechar }: { lancamento: Lancamento; onFechar: (feito: boolean) => void }) {
  const { toast } = useToast()
  const [lista, setLista] = useState<Candidato[] | null>(null)
  const [salvando, setSalvando] = useState(false)
  useEffect(() => { rpc<Candidato[]>('titulos_para_conciliar', { p_lancamento_id: l.id }).then(setLista).catch((e) => { toast(e.message, 'erro'); setLista([]) }) }, [l.id])
  async function escolher(c: Candidato) {
    setSalvando(true)
    try {
      await rpc('conciliar_titulo', { p_lancamento_id: l.id, p_titulo_id: c.titulo_id })
      toast(Number(l.valor) > Number(c.saldo) ? `Conciliado: ${fmtMoeda(Number(l.valor) - Number(c.saldo))} a mais viraram juros/multa` : Number(l.valor) < Number(c.saldo) ? 'Conciliado: baixa parcial do título' : 'Conciliado: título quitado')
      onFechar(true)
    } catch (e: any) { toast(e.message, 'erro'); setSalvando(false) }
  }
  const pagar = l.tipo === 'SAIDA'
  return (
    <Modal aberto titulo={`Conciliar com conta a ${pagar ? 'pagar' : 'receber'}`} onFechar={() => onFechar(false)} largura="max-w-3xl">
      <div className="mb-2 rounded bg-grafite-50 px-2 py-1 text-xs">
        <b>{fmtData(l.data)}</b> · {l.conta} · {l.extrato_descricao ?? l.descricao} · <b className={pagar ? 'text-red-700' : 'text-emerald-700'}>{fmtMoeda(l.valor)}</b>
      </div>
      {!lista ? <Carregando className="min-h-[20vh]" /> : lista.length === 0 ? <Vazio texto={`Nenhuma conta a ${pagar ? 'pagar' : 'receber'} em aberto. Cadastre o título ou classifique a linha.`} /> : (
        <table className="tabela">
          <thead><tr><th>Vencimento</th><th>Descrição</th><th>{pagar ? 'Fornecedor' : 'Cliente'}</th><th className="num">Saldo</th><th className="num">Diferença</th><th></th></tr></thead>
          <tbody>
            {lista.map((c) => (
              <tr key={c.titulo_id} className={Number(c.diferenca) === 0 ? 'font-semibold' : ''}>
                <td className="whitespace-nowrap">{fmtData(c.vencimento)}{c.dias > 0 && <span className="ml-1 text-[10px] text-slate-400">{c.dias}d</span>}</td>
                <td>{c.descricao}</td><td>{c.parceiro}</td>
                <td className="num">{fmtValor(c.saldo)}</td>
                <td className="num">{Number(c.diferenca) === 0 ? <Chip cor="verde">exato</Chip> : fmtValor(c.diferenca)}</td>
                <td className="text-right"><button className="btn-primary py-0 text-[11px]" disabled={salvando} onClick={() => escolher(c)}>Escolher</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-2 text-[11px] text-slate-500">Se o banco mostra mais que o saldo do título, a diferença vira juros/multa; se mostra menos, a baixa fica parcial. Para desfazer, estorne a baixa no título.</p>
    </Modal>
  )
}

/** mesma classificação para várias linhas (todas entradas ou todas saídas) e confirma */
function ClassificarLote({ linhas, cad, onFechar }: { linhas: Lancamento[]; cad: Cadastros; onFechar: (mudou: boolean) => void }) {
  const { toast } = useToast()
  const tipo = linhas[0].tipo
  const [planoId, setPlanoId] = useState<number | ''>('')
  const [centroId, setCentroId] = useState<number | ''>('')
  const [parceiroId, setParceiroId] = useState<number | null>(null)
  const [salvando, setSalvando] = useState(false)
  async function aplicar() {
    if (!planoId) { toast('Escolha a conta do plano', 'erro'); return }
    if (cad.planos.find((p) => p.id === planoId)?.nome === 'A classificar') { toast('Escolha uma conta do plano diferente de "A classificar"', 'erro'); return }
    setSalvando(true)
    try {
      const dados: Record<string, unknown> = { plano_conta_id: planoId, situacao: 'CONFIRMADO' }
      if (centroId) dados.centro_custo_id = centroId
      if (parceiroId) dados.parceiro_id = parceiroId
      ok(await supabase.from('lancamento').update(dados).in('id', linhas.map((l) => l.id)))
      toast(`${linhas.length} lançamento(s) classificados e confirmados`); onFechar(true)
    } catch (e: any) { toast(e.message, 'erro'); setSalvando(false) }
  }
  return (
    <Modal aberto titulo={`Classificar ${linhas.length} ${tipo === 'ENTRADA' ? 'entrada(s)' : 'saída(s)'}`} onFechar={() => onFechar(false)} largura="max-w-lg">
      <div className="ficha grid gap-2">
        <div className="text-xs text-slate-600">Total {fmtMoeda(somar(linhas.map((l) => l.valor)))}. As linhas são confirmadas com a classificação abaixo (cliente/fornecedor e centro só mudam se escolhidos).</div>
        <Campo label="Conta do plano">
          <select className="input" value={planoId} onChange={(e) => setPlanoId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">— escolha —</option><OpcoesPlano planos={cad.planos} filtro={(c) => c.tipo === tipo} />
          </select>
        </Campo>
        <Campo label={tipo === 'ENTRADA' ? 'Cliente' : 'Fornecedor'}><ComboParceiro parceiros={cad.parceiros} valor={parceiroId} tipo={tipo === 'ENTRADA' ? 'CLIENTE' : 'FORNECEDOR'} onChange={setParceiroId} /></Campo>
        <Campo label="Centro de custo">
          <select className="input" value={centroId} onChange={(e) => setCentroId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">—</option>{cad.centros.filter((c) => c.ativo).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </Campo>
        <div className="acoes flex justify-end gap-2"><button className="btn-secondary" onClick={() => onFechar(false)}>Cancelar</button><button className="btn-primary" disabled={salvando} onClick={aplicar}>✓ Classificar e confirmar</button></div>
      </div>
    </Modal>
  )
}
