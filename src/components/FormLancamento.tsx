// Ficha de lançamento (entrada, saída ou transferência) com documentos anexados. Usada em Lançamentos e na Conciliação.
// O centro de custo (0007, como no Luminexus) direciona o tipo: escolher um centro de entrada faz uma entrada, de saída
// uma saída; "Transferência entre contas" não tem centro. Lançamento de baixa de título (titulo_id) só muda descrição,
// documento e forma (o banco recusa o resto: para mudar data, valor ou conta, estorne no título). Pendente (veio do
// extrato) tem a direção do banco: só centros do mesmo tipo; é confirmado aqui.
import { useEffect, useState } from 'react'
import { supabase, ok } from '@/lib/supabase'
import type { ParceiroLista } from '@/lib/dados'
import { fmtData, fmtMoeda, fmtValor, hojeISO, mascaraMoeda, parsePreco } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { descricaoParcela } from '@/lib/titulos'
import {
  COLUNAS_LANCAMENTO, FORMAS_PAGAMENTO, ehFinanceiro, ehOperador, soColunas,
  type Anexo, type ContaFinanceira, type FormaPagamento, type Lancamento, type PlanoConta, type TipoLancamento,
} from '@/lib/types'
import { Campo, Chip, Confirmar, Modal, Opcoes, useToast } from './ui'
import OpcoesPlano from './OpcoesPlano'
import NovoPlanoConta from './NovoPlanoConta'
import ComboParceiro from './ComboParceiro'
import Anexos, { apagarArquivos, gravarAnexos, listarAnexos } from './Anexos'

/** cadastro rápido de cliente/fornecedor pelo nome digitado no combo; devolve o id */
export async function cadastrarParceiroRapido(nome: string, tipo: 'CLIENTE' | 'FORNECEDOR'): Promise<number> {
  const r = ok<{ id: number }>(await supabase.from('parceiro').insert({ nome, tipo, pessoa: 'PJ' }).select('id').single())
  return r.id
}

export default function FormLancamento({ inicial, planos, contas, parceiros, onPlanos, onParceiros, onFechar }: {
  inicial: Partial<Lancamento>; planos: PlanoConta[]; contas: ContaFinanceira[]; parceiros: ParceiroLista[]
  onPlanos: () => Promise<unknown> | void; onParceiros: () => Promise<unknown> | void; onFechar: (mudou: boolean) => void
}) {
  const { toast } = useToast()
  const { perfil } = useAuth()
  const podeEscrever = ehOperador(perfil)
  const [l, setL] = useState<Partial<Lancamento>>({ situacao: 'CONFIRMADO', ...inicial })
  const [valorTxt, setValorTxt] = useState(inicial.valor ? fmtValor(inicial.valor) : '')
  const [competencia, setCompetencia] = useState((inicial.competencia ?? inicial.data ?? hojeISO()).slice(0, 7))
  const [compManual, setCompManual] = useState(!!inicial.id && !!inicial.competencia && inicial.competencia.slice(0, 7) !== (inicial.data ?? '').slice(0, 7))
  const [outro, setOutro] = useState(false)
  const [confirma, setConfirma] = useState(false)
  const [mudou, setMudou] = useState(false)
  const [novoPlano, setNovoPlano] = useState(false)
  const [anexos, setAnexos] = useState<Anexo[]>([])
  const [novos, setNovos] = useState<File[]>([])
  const [sair, setSair] = useState<Set<number>>(new Set())
  const [salvando, setSalvando] = useState(false)
  useEffect(() => { if (inicial.id) listarAnexos({ lancamento_id: inicial.id }).then(setAnexos).catch((e) => toast(e.message, 'erro')) }, [inicial.id])
  const baixa = !!l.titulo_id
  const travado = baixa || !podeEscrever
  const plano = planos.find((p) => p.id === l.plano_conta_id)
  const transf = l.tipo === 'TRANSFERENCIA'
  // a direção já está decidida (baixa de título ou linha do extrato): só centros do mesmo tipo
  const tipoFixo = baixa || (!!l.id && l.situacao === 'PENDENTE')

  /** escolha do centro de custo (ou da transferência): o tipo do lançamento vem dele */
  function escolherCentro(v: string) {
    if (v === 'T') { setL({ ...l, tipo: 'TRANSFERENCIA', plano_conta_id: null, parceiro_id: null }); return }
    const c = planos.find((p) => p.id === Number(v))
    if (!c) { setL({ ...l, plano_conta_id: null }); return }
    setL({ ...l, plano_conta_id: c.id, tipo: c.tipo, parceiro_id: c.tipo === l.tipo ? l.parceiro_id : null, conta_destino_id: null })
  }

  function mudarData(d: string) {
    setL({ ...l, data: d })
    if (!compManual && d) setCompetencia(d.slice(0, 7))
  }

  async function salvar(confirmar = false) {
    if (!podeEscrever || salvando) return
    const valor = parsePreco(valorTxt)
    if (!l.data) { toast('Informe a data', 'erro'); return }
    if (!valor || valor <= 0) { toast('Informe o valor', 'erro'); return }
    if (!l.conta_id) { toast('Escolha a conta', 'erro'); return }
    if (!transf && !l.plano_conta_id) { toast('Escolha o centro de custo', 'erro'); return }
    if (transf && !l.conta_destino_id) { toast('Escolha a conta de destino', 'erro'); return }
    if (confirmar && plano?.nome === 'A classificar') { toast('Escolha o centro de custo antes de confirmar (não pode ficar "A classificar")', 'erro'); return }
    setSalvando(true)
    try {
      const dados = baixa
        // baixa de título: só os campos que o banco deixa mudar
        ? { descricao: l.descricao || null, documento: l.documento || null, forma: l.forma || null }
        : soColunas({
            ...l, valor, competencia: `${competencia}-01`,
            situacao: confirmar ? 'CONFIRMADO' : (l.situacao ?? 'CONFIRMADO'),
            plano_conta_id: transf ? null : l.plano_conta_id, conta_destino_id: transf ? l.conta_destino_id : null,
            parceiro_id: transf ? null : l.parceiro_id ?? null,
            forma: l.forma || null, descricao: l.descricao || null, documento: l.documento || null,
          } as Lancamento, COLUNAS_LANCAMENTO)
      const id = l.id
        ? (ok(await supabase.from('lancamento').update(dados).eq('id', l.id).select('id').single()) as { id: number }).id
        : (ok(await supabase.from('lancamento').insert(dados).select('id').single()) as { id: number }).id
      setMudou(true)
      const erros = novos.length || sair.size ? await gravarAnexos({ lancamento_id: id }, novos, anexos.filter((a) => sair.has(a.id))) : []
      if (erros.length) {
        // o lançamento ficou salvo: a ficha continua aberta nele para tentar de novo
        toast(`Lançamento salvo, mas ${erros.length} documento(s) falharam: ${erros.join('; ')}`, 'erro')
        setL({ ...l, id }); setNovos(novos.filter((f) => erros.some((e) => e.startsWith(f.name)))); setSair(new Set())
        setAnexos(await listarAnexos({ lancamento_id: id }).catch(() => anexos))
        return
      }
      toast(confirmar ? 'Lançamento confirmado' : 'Lançamento salvo')
      if (outro && !l.id) {
        setL({ tipo: l.tipo, data: l.data, conta_id: l.conta_id, conta_destino_id: l.conta_destino_id, plano_conta_id: l.plano_conta_id, forma: l.forma, situacao: 'CONFIRMADO' })
        setValorTxt(''); setNovos([])
      } else onFechar(true)
    } catch (e: any) { toast(e.message, 'erro') } finally { setSalvando(false) }
  }
  async function excluir() {
    setConfirma(false)
    try {
      ok(await supabase.from('lancamento').delete().eq('id', l.id!))
      await apagarArquivos(anexos)
      toast('Lançamento excluído'); onFechar(true)
    } catch (e: any) { toast(e.message, 'erro') }
  }
  async function novoParceiro(nome: string) {
    try {
      const id = await cadastrarParceiroRapido(nome, l.tipo === 'ENTRADA' ? 'CLIENTE' : 'FORNECEDOR')
      await onParceiros(); setL((x) => ({ ...x, parceiro_id: id })); toast(`${nome} cadastrado`)
    } catch (e: any) { toast(e.message, 'erro') }
  }

  const titulo = l.id ? `Lançamento #${l.id}${l.situacao === 'PENDENTE' ? ' (pendente)' : ''}` : 'Novo lançamento'
  return (
    <Modal aberto titulo={titulo} onFechar={() => onFechar(mudou)} largura="max-w-2xl">
      <div className="ficha grid grid-cols-1 gap-2 sm:grid-cols-4">
        {baixa && (
          <div className="sm:col-span-4 rounded bg-sky-50 px-2 py-1 text-[11px] text-sky-900">
            {l.titulo_papel === 'PRINCIPAL' ? 'Baixa' : l.titulo_papel === 'JUROS' ? 'Juros/multa da baixa' : 'Desconto da baixa'} do título a {l.titulo_tipo === 'PAGAR' ? 'pagar' : 'receber'}
            {' '}<b>{descricaoParcela(l.descricao ?? '', l.parcela, l.parcelas)}</b>. Aqui só mudam descrição, documento e forma;
            para mudar data, valor ou conta, estorne a baixa em {l.titulo_tipo === 'PAGAR' ? 'Contas a pagar' : 'Contas a receber'} e baixe de novo.
          </div>
        )}
        {l.extrato_descricao && <div className="sm:col-span-4 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-900"><b>No extrato:</b> {l.extrato_descricao}{l.situacao === 'PENDENTE' && ' · aguardando classificação: escolha o centro de custo (e o cliente/fornecedor) e clique em Confirmar.'}</div>}
        <Campo label="Centro de custo" className="sm:col-span-3">
          <div className="flex gap-1">
            <select className="input" disabled={travado} autoFocus={!l.id && !inicial.plano_conta_id && !inicial.tipo} value={transf ? 'T' : l.plano_conta_id ?? ''} onChange={(e) => escolherCentro(e.target.value)}>
              <option value="">— escolha —</option>
              <OpcoesPlano planos={planos} filtro={tipoFixo ? (c) => c.tipo === l.tipo : undefined} atual={l.plano_conta_id} />
              {(!tipoFixo || transf) && <optgroup label="⇄ Entre contas"><option value="T">Transferência entre contas (sem centro de custo)</option></optgroup>}
            </select>
            {!travado && ehFinanceiro(perfil) && <button type="button" className="btn-secondary px-2" title="Novo centro de custo" onClick={() => setNovoPlano(true)}>+</button>}
          </div>
        </Campo>
        <Campo label="Tipo (pelo centro)">
          <div className="input flex items-center bg-slate-50">
            {transf ? <Chip cor="azul">⇄ Transferência</Chip> : l.plano_conta_id ? <Chip cor={l.tipo === 'ENTRADA' ? 'verde' : 'vermelho'}>{l.tipo === 'ENTRADA' ? '▲ Entrada' : '▼ Saída'}</Chip> : <span className="text-slate-400">—</span>}
          </div>
        </Campo>
        <Campo label="Data"><input className="input" type="date" disabled={travado} value={l.data ?? ''} onChange={(e) => mudarData(e.target.value)} /></Campo>
        <Campo label="Valor (R$)"><input className="input text-right font-semibold" inputMode="decimal" disabled={travado} autoFocus={!l.id && (!!inicial.plano_conta_id || !!inicial.tipo)} value={valorTxt} onChange={(e) => setValorTxt(mascaraMoeda(e.target.value))} /></Campo>
        {!transf && (
          <Campo label="Competência (mês da DRE)">
            <input className="input" type="month" disabled={travado} value={competencia} onChange={(e) => { if (e.target.value) { setCompetencia(e.target.value); setCompManual(true) } }} />
          </Campo>
        )}
        <Campo label="Documento" className={transf ? 'sm:col-span-2' : ''}><input className="input" disabled={!podeEscrever} value={l.documento ?? ''} onChange={(e) => setL({ ...l, documento: e.target.value })} placeholder="nº nota/recibo" /></Campo>
        <Campo label={transf ? 'Conta de origem' : 'Conta'} className="sm:col-span-2">
          <select className="input" disabled={travado} value={l.conta_id ?? ''} onChange={(e) => setL({ ...l, conta_id: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">— escolha —</option>{contas.filter((c) => c.ativa || c.id === l.conta_id).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </Campo>
        {transf ? (
          <Campo label="Conta de destino" className="sm:col-span-2">
            <select className="input" disabled={travado} value={l.conta_destino_id ?? ''} onChange={(e) => setL({ ...l, conta_destino_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">— escolha —</option>{contas.filter((c) => (c.ativa || c.id === l.conta_destino_id) && c.id !== l.conta_id).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </Campo>
        ) : (
          <Campo label={l.tipo === 'ENTRADA' ? 'Cliente' : l.tipo === 'SAIDA' ? 'Fornecedor' : 'Cliente / fornecedor'} className="sm:col-span-2">
            {travado ? <div className="input bg-slate-100">{parceiros.find((p) => p.id === l.parceiro_id)?.nome_fantasia || parceiros.find((p) => p.id === l.parceiro_id)?.nome || l.parceiro || '—'}</div>
              : <ComboParceiro parceiros={parceiros} valor={l.parceiro_id ?? null} tipo={l.tipo === 'ENTRADA' ? 'CLIENTE' : 'FORNECEDOR'} onChange={(id) => setL({ ...l, parceiro_id: id })} onNovo={novoParceiro} />}
          </Campo>
        )}
        <Campo label="Forma" className="sm:col-span-2"><Opcoes valor={l.forma} opcoes={FORMAS_PAGAMENTO} disabled={!podeEscrever} onChange={(v) => setL({ ...l, forma: (v || null) as FormaPagamento | null })} vazio="—" /></Campo>
        <Campo label="Descrição" className="sm:col-span-2"><input className="input" disabled={!podeEscrever} value={l.descricao ?? ''} onChange={(e) => setL({ ...l, descricao: e.target.value })} placeholder="ex.: Energia ref. setembro" /></Campo>
        <div className="sm:col-span-4"><Anexos atuais={anexos} sair={sair} novos={novos} onNovos={setNovos} onSair={setSair} somenteLeitura={!podeEscrever} /></div>
        {l.id && l.criado_em && <div className="sm:col-span-4 text-[10px] text-slate-400">Incluído em {fmtData(l.criado_em.slice(0, 10))}{l.origem === 'IMPORTACAO' ? ' (extrato)' : l.origem === 'BAIXA' ? ' (baixa de título)' : ''}</div>}
        <div className="acoes sm:col-span-4 flex flex-wrap items-center justify-between gap-2 pt-1">
          <div>{l.id ? (!baixa && ehFinanceiro(perfil) && <button className="btn-danger" onClick={() => setConfirma(true)}>Excluir</button>)
            : podeEscrever && <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={outro} onChange={(e) => setOutro(e.target.checked)} /> lançar outro em seguida (mesma data, conta e centro de custo)</label>}</div>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => onFechar(mudou)}>{mudou || !podeEscrever ? 'Fechar' : 'Cancelar'}</button>
            {podeEscrever && (l.situacao === 'PENDENTE'
              ? <><button className="btn-secondary" disabled={salvando} onClick={() => salvar(false)}>Salvar e deixar pendente</button><button className="btn-primary" disabled={salvando} onClick={() => salvar(true)}>✓ Confirmar lançamento</button></>
              : <button className="btn-primary" disabled={salvando} onClick={() => salvar(false)}>Salvar</button>)}
          </div>
        </div>
      </div>
      {novoPlano && <NovoPlanoConta lista={tipoFixo ? planos.filter((c) => c.tipo === l.tipo) : planos} tipo={l.tipo === 'ENTRADA' ? 'ENTRADA' : 'SAIDA'} onFechar={async (criada) => {
        setNovoPlano(false)
        if (criada) { await onPlanos(); if (criada.nivel > 1) setL((x) => ({ ...x, plano_conta_id: criada.id, tipo: criada.tipo, conta_destino_id: null })) }
      }} />}
      <Confirmar aberto={confirma} perigo titulo="Excluir lançamento" texto={`Excluir o lançamento de ${fmtMoeda(l.valor)} de ${fmtData(l.data)}?`} onNao={() => setConfirma(false)} onSim={excluir} />
    </Modal>
  )
}
