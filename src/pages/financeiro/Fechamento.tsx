// Fechamento do mês (Luminexus 0064 → FinFlow 0003): o financeiro fecha o mês, o banco grava o balancete e trava os
// lançamentos daquele mês; o contador dá o parecer (aprovado, com ressalvas ou devolvido — devolvido destrava). Só a
// diretoria reabre um mês fechado.
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, ok } from '@/lib/supabase'
import { rpc } from '@/lib/dados'
import { useAuth } from '@/lib/auth'
import { fmtDataHora, fmtMoeda, fmtValor, mesAtual, mesCurto, nomeMes, somar, somarMes } from '@/lib/format'
import { fmtCodigoCurto } from '@/lib/planoContas'
import { cabecalhoImpressao, escHtml, imprimirHtml } from '@/lib/imprimir'
import { nomeDaEmpresa, useDadosEmpresa } from '@/lib/empresa'
import { STATUS_FECHAMENTO, ehContador, ehDiretor, ehFinanceiro, type Balancete, type FechamentoMes, type StatusFechamento } from '@/lib/types'
import { BotaoAtualizar, Campo, Carregando, Chip, Confirmar, Modal, Titulo, useToast, type CorChip } from '@/components/ui'
import { Indicador, Secao } from '@/components/Painel'

const COR_STATUS: Record<StatusFechamento, CorChip> = { FECHADO: 'azul', APROVADO: 'verde', RESSALVA: 'amarelo', DEVOLVIDO: 'vermelho' }
type Parecer = 'APROVADO' | 'RESSALVA' | 'DEVOLVIDO'

/** entradas e saídas do balancete agrupadas pela conta do 1º nível */
function grupos(b: Balancete, tipo: 'ENTRADA' | 'SAIDA') {
  const m = new Map<number, { raiz: string; total: number; itens: Balancete['planos'] }>()
  for (const p of b.planos.filter((x) => x.tipo === tipo)) {
    const g = m.get(p.raiz_codigo) ?? { raiz: p.raiz, total: 0, itens: [] }
    g.total = somar([g.total, p.total]); g.itens.push(p); m.set(p.raiz_codigo, g)
  }
  return [...m.entries()].sort(([a], [b2]) => a - b2).map(([, g]) => g)
}

function VerBalancete({ b }: { b: Balancete }) {
  const bloco = (tipo: 'ENTRADA' | 'SAIDA') => {
    const gs = grupos(b, tipo)
    return gs.length === 0 ? <div className="py-2 text-xs text-slate-400">Nenhum lançamento.</div> : (
      <table className="tabela"><tbody>
        {gs.map((g) => (
          <Fragment key={g.raiz}>
            <tr><td className="font-bold">{g.raiz}</td><td className="num font-bold">{fmtValor(g.total)}</td></tr>
            {g.itens.map((p) => <tr key={p.plano_conta_id}><td className="pl-5 text-slate-600"><span className="mr-1 font-mono text-[10px] text-slate-400">{fmtCodigoCurto(p.codigo)}</span>{p.nome} <span className="text-slate-400">({p.qtd})</span></td><td className="num">{fmtValor(p.total)}</td></tr>)}
          </Fragment>
        ))}
      </tbody></table>
    )
  }
  return (
    <>
      <div className="mb-1.5 grid grid-cols-2 gap-1.5 lg:grid-cols-4">
        <Indicador rotulo="Saldo inicial" valor={fmtMoeda(b.saldo_inicial)} />
        <Indicador rotulo="Entradas" valor={fmtMoeda(b.entradas)} tom="entrada" />
        <Indicador rotulo="Saídas" valor={fmtMoeda(b.saidas)} tom="saida" />
        <Indicador rotulo="Saldo final" valor={fmtMoeda(b.saldo_final)} tom="destaque" />
      </div>
      <div className="grid grid-cols-1 gap-1.5 lg:grid-cols-3">
        <Secao titulo="Entradas" abertoInicial>{bloco('ENTRADA')}</Secao>
        <Secao titulo="Saídas" abertoInicial>{bloco('SAIDA')}</Secao>
        <Secao titulo="Contas">
          <table className="tabela">
            <thead><tr><th>Conta</th><th className="num">Inicial</th><th className="num">Final</th></tr></thead>
            <tbody>{b.contas.map((c) => <tr key={c.id ?? c.nome}><td>{c.nome}</td><td className="num">{fmtValor(c.inicial)}</td><td className="num font-semibold">{fmtValor(c.final)}</td></tr>)}</tbody>
          </table>
        </Secao>
      </div>
    </>
  )
}

export default function Fechamento() {
  const { toast } = useToast()
  const { perfil } = useAuth()
  const empresa = useDadosEmpresa()
  const atual = mesAtual()
  const meses = useMemo(() => Array.from({ length: 13 }, (_, i) => somarMes(atual, -i)), [atual])
  const [lista, setLista] = useState<FechamentoMes[] | null>(null)
  const [mes, setMes] = useState(somarMes(atual, -1))
  const [previa, setPrevia] = useState<Balancete | null>(null)
  const [fechar, setFechar] = useState(false)
  const [obs, setObs] = useState('')
  const [parecer, setParecer] = useState<{ status: Parecer; texto: string } | null>(null)
  const [reabrir, setReabrir] = useState(false)
  const [salvando, setSalvando] = useState(false)

  const carregarLista = () => Promise.resolve(supabase.from('fechamento_mes').select('*').gte('mes', `${meses[meses.length - 1]}-01`).order('mes', { ascending: false }))
    .then((r) => setLista(ok(r) as FechamentoMes[])).catch((e) => { toast(e.message, 'erro'); setLista([]) })
  useEffect(() => { carregarLista() }, [])
  const f = lista?.find((x) => x.mes.slice(0, 7) === mes) ?? null
  const fechado = !!f && f.status !== 'DEVOLVIDO'
  useEffect(() => {
    setPrevia(null)
    if (!lista || fechado) return
    rpc<Balancete>('balancete_mes', { p_mes: `${mes}-01` }).then(setPrevia).catch((e) => toast(e.message, 'erro'))
  }, [mes, lista, fechado])
  const atualizar = () => { setLista(null); carregarLista() }
  const b = fechado ? f!.resumo : previa
  const terminou = mes < atual

  async function executar(fn: () => PromiseLike<unknown>, msg: string) {
    setSalvando(true)
    try { await fn(); toast(msg); setFechar(false); setParecer(null); setReabrir(false); setObs(''); atualizar() }
    catch (e: any) { toast(e.message, 'erro') } finally { setSalvando(false) }
  }
  const fecharMes = () => executar(() => rpc('fechar_mes', { p_mes: `${mes}-01`, p_observacao: obs || null }), `${nomeMes(mes)} fechado. Os lançamentos do mês estão travados.`)
  const darParecer = () => {
    if (!parecer) return
    if (parecer.status !== 'APROVADO' && parecer.texto.trim().length < 5) { toast('Escreva o motivo da ressalva ou da devolução', 'erro'); return }
    executar(() => rpc('avaliar_fechamento', { p_mes: `${mes}-01`, p_status: parecer.status, p_parecer: parecer.texto.trim() || null }), 'Parecer registrado')
  }
  const reabrirMes = () => executar(() => rpc('reabrir_mes', { p_mes: `${mes}-01` }), `${nomeMes(mes)} reaberto`)

  function imprimir() {
    if (!b) return
    const linhas = (tipo: 'ENTRADA' | 'SAIDA') => grupos(b, tipo).map((g) => `<tr><td style="font-weight:700">${escHtml(g.raiz)}</td><td class="num" style="font-weight:700">${fmtValor(g.total)}</td></tr>${g.itens.map((p) => `<tr><td style="padding-left:16px">${fmtCodigoCurto(p.codigo)} ${escHtml(p.nome)}</td><td class="num">${fmtValor(p.total)}</td></tr>`).join('')}`).join('')
    const titulo = `Balancete · ${nomeMes(mes)}`
    const situacao = f ? `${STATUS_FECHAMENTO[f.status]} · fechado em ${fmtDataHora(f.fechado_em)}` : 'Prévia (mês ainda não fechado)'
    imprimirHtml(titulo, `${cabecalhoImpressao(nomeDaEmpresa(empresa), titulo, situacao)}
      <table class="tabela" style="margin-bottom:8px"><tbody><tr><td>Saldo inicial</td><td class="num">${fmtValor(b.saldo_inicial)}</td></tr><tr><td>Entradas</td><td class="num">${fmtValor(b.entradas)}</td></tr><tr><td>Saídas</td><td class="num">${fmtValor(b.saidas)}</td></tr><tr><td style="font-weight:800">Saldo final</td><td class="num" style="font-weight:800">${fmtValor(b.saldo_final)}</td></tr></tbody></table>
      <h2 style="font-size:11pt;margin:8px 0 2px">Entradas</h2><table class="tabela"><tbody>${linhas('ENTRADA')}</tbody></table>
      <h2 style="font-size:11pt;margin:8px 0 2px">Saídas</h2><table class="tabela"><tbody>${linhas('SAIDA')}</tbody></table>
      <h2 style="font-size:11pt;margin:8px 0 2px">Contas</h2><table class="tabela"><thead><tr><th>Conta</th><th class="num">Inicial</th><th class="num">Final</th></tr></thead><tbody>${b.contas.map((c) => `<tr><td>${escHtml(c.nome)}</td><td class="num">${fmtValor(c.inicial)}</td><td class="num">${fmtValor(c.final)}</td></tr>`).join('')}</tbody></table>
      ${f?.observacao ? `<p><b>Observação do financeiro:</b> ${escHtml(f.observacao)}</p>` : ''}${f?.parecer ? `<p><b>Parecer do contador:</b> ${escHtml(f.parecer)}</p>` : ''}
      <div style="display:flex;gap:40px;margin-top:40px;font-size:9pt"><div style="flex:1;border-top:1px solid #334155;text-align:center;padding-top:4px">Financeiro</div><div style="flex:1;border-top:1px solid #334155;text-align:center;padding-top:4px">Contador</div><div style="flex:1;border-top:1px solid #334155;text-align:center;padding-top:4px">Diretoria</div></div>`)
  }

  if (!lista) return <Carregando />
  return (
    <div className="mx-auto max-w-6xl">
      <div className="barra">
        <Titulo>Fechamento do mês</Titulo>
        <BotaoAtualizar onClick={atualizar} />
        <span className="text-slate-500">O financeiro fecha → os lançamentos do mês travam → o contador dá o parecer (devolvido destrava para correção); só a diretoria reabre.</span>
      </div>
      <div className="mb-1.5 flex flex-wrap gap-1">
        {[...meses].reverse().map((m) => {
          const x = lista.find((y) => y.mes.slice(0, 7) === m)
          return (
            <button key={m} onClick={() => setMes(m)} title={x ? STATUS_FECHAMENTO[x.status] : m < atual ? 'Aberto' : 'Mês em andamento'}
              className={`rounded-lg border px-2 py-1 text-xs font-semibold ${mes === m ? 'border-grafite-900 bg-grafite-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-grafite-50'}`}>
              {mesCurto(m)} <span className="ml-0.5">{x ? (x.status === 'APROVADO' ? '✅' : x.status === 'RESSALVA' ? '⚠️' : x.status === 'DEVOLVIDO' ? '↩️' : '🔒') : m < atual ? '○' : '…'}</span>
            </button>
          )
        })}
      </div>

      <div className="card mb-1.5 flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
        <b className="text-sm text-grafite-900">{nomeMes(mes)}</b>
        {f ? <Chip cor={COR_STATUS[f.status]}>{STATUS_FECHAMENTO[f.status]}</Chip> : <Chip cor="cinza">{terminou ? 'Aberto' : 'Mês em andamento'}</Chip>}
        {f && <span className="text-slate-500">fechado em {fmtDataHora(f.fechado_em)}{f.avaliado_em ? ` · parecer em ${fmtDataHora(f.avaliado_em)}` : ''}</span>}
        <div className="ml-auto flex flex-wrap gap-1.5">
          {ehFinanceiro(perfil) && !fechado && terminou && <button className="btn-primary" onClick={() => setFechar(true)} disabled={!previa}>🔒 Fechar o mês</button>}
          {ehContador(perfil) && f?.status === 'FECHADO' && <button className="btn-accent" onClick={() => setParecer({ status: 'APROVADO', texto: '' })}>Dar parecer</button>}
          {ehDiretor(perfil) && fechado && <button className="btn-secondary" onClick={() => setReabrir(true)}>Reabrir mês</button>}
          <button className="btn-secondary" onClick={imprimir} disabled={!b}>🖨️ Balancete</button>
        </div>
      </div>
      {f?.observacao && <div className="mb-1.5 rounded-lg bg-grafite-50 px-3 py-1.5 text-xs"><b>Observação do financeiro:</b> {f.observacao}</div>}
      {f?.parecer && <div className={`mb-1.5 rounded-lg px-3 py-1.5 text-xs ${f.status === 'DEVOLVIDO' ? 'bg-red-50 text-red-900' : f.status === 'RESSALVA' ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-900'}`}><b>Parecer do contador:</b> {f.parecer}</div>}
      {!fechado && previa && previa.pendentes > 0 && (
        <div className="mb-1.5 flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
          <span>⚠️ {previa.pendentes} lançamento(s) pendente(s) neste mês: classifique ou exclua antes de fechar.</span>
          <Link to="/financeiro/conciliacao" className="btn-secondary py-0.5">Conciliar</Link>
        </div>
      )}
      {!fechado && <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{f?.status === 'DEVOLVIDO' ? 'Devolvido: prévia com os lançamentos de agora' : 'Prévia (mês ainda não fechado)'}</div>}
      {b ? <VerBalancete b={b} /> : <Carregando className="min-h-[20vh]" />}

      <Modal aberto={fechar} titulo={`Fechar ${nomeMes(mes)}`} onFechar={() => setFechar(false)} largura="max-w-md">
        <div className="ficha space-y-2 text-sm">
          {previa && <p className="text-slate-600">Saldo final {fmtMoeda(previa.saldo_final)} · entradas {fmtMoeda(previa.entradas)} · saídas {fmtMoeda(previa.saidas)}.</p>}
          <p className="text-xs text-slate-600">Depois de fechado, nenhum lançamento com data neste mês entra, muda ou sai, até o contador devolver ou a diretoria reabrir. O balancete fica gravado como está agora.</p>
          {previa && previa.pendentes > 0 && <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">Há {previa.pendentes} lançamento(s) pendente(s): o fechamento será recusado.</p>}
          <Campo label="Observação (opcional)"><textarea className="input" rows={3} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="ex.: conferido com os extratos dos bancos" /></Campo>
          <div className="acoes flex justify-end gap-2"><button className="btn-secondary" onClick={() => setFechar(false)}>Cancelar</button><button className="btn-primary" disabled={salvando} onClick={fecharMes}>Fechar o mês</button></div>
        </div>
      </Modal>
      <Modal aberto={!!parecer} titulo={`Parecer · ${nomeMes(mes)}`} onFechar={() => setParecer(null)} largura="max-w-md">
        {parecer && (
          <div className="ficha space-y-2 text-sm">
            {(['APROVADO', 'RESSALVA', 'DEVOLVIDO'] as Parecer[]).map((s) => (
              <label key={s} className="flex items-center gap-2"><input type="radio" checked={parecer.status === s} onChange={() => setParecer({ ...parecer, status: s })} /> {STATUS_FECHAMENTO[s]}</label>
            ))}
            <Campo label={parecer.status === 'APROVADO' ? 'Comentário (opcional)' : 'Motivo (obrigatório)'}><textarea className="input" rows={4} value={parecer.texto} onChange={(e) => setParecer({ ...parecer, texto: e.target.value })} /></Campo>
            {parecer.status === 'DEVOLVIDO' && <p className="text-xs text-slate-500">Devolvido destrava o mês para o financeiro corrigir e fechar de novo.</p>}
            <div className="acoes flex justify-end gap-2"><button className="btn-secondary" onClick={() => setParecer(null)}>Cancelar</button><button className="btn-primary" disabled={salvando} onClick={darParecer}>Registrar parecer</button></div>
          </div>
        )}
      </Modal>
      <Confirmar aberto={reabrir} perigo titulo="Reabrir mês" texto={`Reabrir ${nomeMes(mes)}? O fechamento e o parecer são apagados (fica na auditoria) e os lançamentos do mês voltam a poder ser alterados.`} onNao={() => setReabrir(false)} onSim={reabrirMes} />
    </div>
  )
}
