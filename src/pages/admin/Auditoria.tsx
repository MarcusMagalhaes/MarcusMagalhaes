// Auditoria: quem fez o quê e quando (registros) e logins (sucesso/falha). Só diretoria, administrador e TI (0005).
// Retenção (0001, limpar_auditoria): registros 13 meses, logins 6 meses.
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { todas } from '@/lib/dados'
import { fmtDataHora, hojeISO, normalizar } from '@/lib/format'
import { BotaoAtualizar, Campo, Carregando, Chip, Modal, Titulo, useToast, Vazio } from '@/components/ui'

const MAX_AUDITORIA = 5000
const NOME_TABELA: Record<string, string> = {
  empresa: 'Empresa', usuario: 'Contas de login', usuario_empresa: 'Acesso à empresa', liberacao_previa: 'Liberação de e-mail',
  conta_financeira: 'Contas financeiras', plano_conta: 'Centros de custo', modelo_lancamento: 'Modelos de lançamento', parceiro: 'Clientes e fornecedores',
  titulo: 'Contas a pagar/receber', lancamento: 'Lançamentos', importacao_extrato: 'Importação de extrato', anexo: 'Documentos anexados',
  orcamento: 'Orçamento', orcamento_parametro: 'Parâmetros do orçamento', fechamento_mes: 'Fechamento do mês',
}
const NOME_OP: Record<string, string> = { INSERT: 'Inclusão', UPDATE: 'Alteração', DELETE: 'Exclusão' }
const COR_OP: Record<string, 'verde' | 'amarelo' | 'vermelho'> = { INSERT: 'verde', UPDATE: 'amarelo', DELETE: 'vermelho' }
const NOME_EVENTO: Record<string, string> = { LOGIN_OK: 'Login com sucesso', LOGIN_FALHA: 'Login sem sucesso', LOGOUT: 'Saiu do sistema' }

interface Reg { id: number; tabela: string; registro_id: string; operacao: string; antes: any; depois: any; usuario_id: string | null; usuario_email: string | null; origem: string; campos_alterados: string[] | null; em: string }
interface Login { id: number; email: string | null; usuario_id: string | null; evento: string; motivo: string | null; metodo: string | null; agente: string | null; em: string }

function descreve(r: Reg) {
  const d = r.depois ?? r.antes ?? {}
  const partes: string[] = []
  for (const k of ['nome', 'razao_social', 'descricao', 'email', 'data', 'vencimento', 'valor', 'tipo', 'papel', 'situacao']) {
    if (d[k] !== undefined && d[k] !== null) partes.push(`${k}: ${d[k]}`)
  }
  return partes.slice(0, 4).join(' · ')
}

export default function Auditoria() {
  const { toast } = useToast()
  const [aba, setAba] = useState<'registros' | 'logins'>('registros')
  const [regs, setRegs] = useState<Reg[] | null>(null)
  const [logins, setLogins] = useState<Login[] | null>(null)
  const [tabela, setTabela] = useState('')
  const [op, setOp] = useState('')
  const [usuarioF, setUsuarioF] = useState('')
  const [de, setDe] = useState(hojeISO())   // abre só com o dia de hoje (carrega rápido); amplie o período no filtro
  const [ate, setAte] = useState(hojeISO())
  const [texto, setTexto] = useState('')
  const [detalhe, setDetalhe] = useState<Reg | null>(null)

  async function carregar() {
    try {
      if (aba === 'registros') {
        setRegs(null)
        const r = await todas<Reg>((ini, fim) => {
          let q = supabase.from('auditoria').select('*').gte('em', new Date(`${de}T00:00:00`).toISOString()).lte('em', new Date(`${ate}T23:59:59.999`).toISOString()).order('em', { ascending: false }).order('id', { ascending: false })
          if (tabela) q = q.eq('tabela', tabela)
          if (op) q = q.eq('operacao', op)
          if (usuarioF) q = q.ilike('usuario_email', `%${usuarioF}%`)
          return q.range(ini, fim)
        }, MAX_AUDITORIA)
        if (r.length >= MAX_AUDITORIA) toast(`Mostrando os ${MAX_AUDITORIA} registros mais recentes: reduza o período.`, 'info')
        setRegs(r)
      } else {
        setLogins(null)
        const r = await todas<Login>((ini, fim) => {
          let q = supabase.from('auditoria_login').select('*').gte('em', new Date(`${de}T00:00:00`).toISOString()).lte('em', new Date(`${ate}T23:59:59.999`).toISOString()).order('em', { ascending: false }).order('id', { ascending: false })
          if (usuarioF) q = q.ilike('email', `%${usuarioF}%`)
          if (op) q = q.eq('evento', op)
          return q.range(ini, fim)
        }, MAX_AUDITORIA)
        setLogins(r)
      }
    } catch (e: any) { toast(e.message, 'erro'); setRegs([]); setLogins([]) }
  }
  useEffect(() => { carregar() }, [aba, tabela, op, usuarioF, de, ate])

  const regsVisiveis = useMemo(() => {
    const t = normalizar(texto)
    return (regs ?? []).filter((r) => !t || normalizar(`${r.registro_id} ${JSON.stringify(r.depois ?? r.antes ?? {})}`).includes(t))
  }, [regs, texto])

  return (
    <div className="flex h-full flex-col">
      <div className="barra">
        <Titulo>Auditoria</Titulo>
        <BotaoAtualizar onClick={() => { carregar() }} />
        <div className="flex rounded-lg border border-slate-300 overflow-hidden">
          {(['registros', 'logins'] as const).map((a) => (
            <button key={a} onClick={() => { setAba(a); setOp('') }} className={`px-3 py-1 text-xs font-semibold ${aba === a ? 'bg-grafite-900 text-white' : 'bg-white text-slate-600'}`}>{a === 'registros' ? 'Registros' : 'Logins'}</button>
          ))}
        </div>
        <Campo label="De"><input className="input" type="date" value={de} onChange={(e) => setDe(e.target.value)} /></Campo>
        <Campo label="até"><input className="input" type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></Campo>
        <Campo label="Usuário"><input className="input" placeholder="e-mail…" value={usuarioF} onChange={(e) => setUsuarioF(e.target.value)} /></Campo>
        {aba === 'registros' ? (
          <>
            <Campo label="Tabela"><select className="input" value={tabela} onChange={(e) => setTabela(e.target.value)}><option value="">Todas</option>{Object.entries(NOME_TABELA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Campo>
            <Campo label="Operação"><select className="input" value={op} onChange={(e) => setOp(e.target.value)}><option value="">Todas</option>{Object.entries(NOME_OP).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Campo>
            <Campo label="Filtrar"><input className="input" placeholder="conteúdo do registro…" value={texto} onChange={(e) => setTexto(e.target.value)} /></Campo>
          </>
        ) : (
          <Campo label="Evento"><select className="input" value={op} onChange={(e) => setOp(e.target.value)}><option value="">Todos</option>{Object.entries(NOME_EVENTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Campo>
        )}
        <span className="text-[11px] text-slate-500 ml-auto">{aba === 'registros' ? `${regsVisiveis.length} registros` : `${(logins ?? []).length} eventos`}</span>
      </div>
      <div className="card flex-1 min-h-0 overflow-auto">
        {aba === 'registros' ? (regs === null ? <Carregando /> : regsVisiveis.length === 0 ? <Vazio texto="Nenhum registro no período" /> : (
          <table className="tabela">
            <thead><tr><th>Quando</th><th>Quem</th><th>Operação</th><th>Onde</th><th>Registro</th><th>O que mudou</th><th></th></tr></thead>
            <tbody>
              {regsVisiveis.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-grafite-50" onClick={() => setDetalhe(r)}>
                  <td className="whitespace-nowrap">{fmtDataHora(r.em)}</td>
                  <td className="whitespace-nowrap">{r.usuario_email ?? <span className="text-slate-400">{r.origem}</span>}</td>
                  <td><Chip cor={COR_OP[r.operacao] ?? 'cinza'}>{NOME_OP[r.operacao] ?? r.operacao}</Chip></td>
                  <td className="whitespace-nowrap">{NOME_TABELA[r.tabela] ?? r.tabela}</td>
                  <td className="text-slate-500">#{r.registro_id}</td>
                  <td className="max-w-[480px] truncate" title={descreve(r)}>{r.operacao === 'UPDATE' && r.campos_alterados ? r.campos_alterados.join(', ') : descreve(r)}</td>
                  <td className="text-right"><button className="btn-secondary py-0.5">Ver</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )) : (logins === null ? <Carregando /> : logins.length === 0 ? <Vazio texto="Nenhum login no período" /> : (
          <table className="tabela">
            <thead><tr><th>Quando</th><th>E-mail</th><th>Evento</th><th>Método</th><th>Motivo</th><th>Navegador</th></tr></thead>
            <tbody>
              {logins.map((l) => (
                <tr key={l.id}>
                  <td className="whitespace-nowrap">{fmtDataHora(l.em)}</td><td>{l.email}</td>
                  <td><Chip cor={l.evento === 'LOGIN_OK' ? 'verde' : l.evento === 'LOGOUT' ? 'cinza' : 'vermelho'}>{NOME_EVENTO[l.evento] ?? l.evento}</Chip></td>
                  <td>{l.metodo}</td><td>{l.motivo}</td>
                  <td className="max-w-[360px] truncate text-slate-500" title={l.agente ?? ''}>{l.agente}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
      {detalhe && (
        <Modal aberto titulo={`${NOME_OP[detalhe.operacao]} em ${NOME_TABELA[detalhe.tabela] ?? detalhe.tabela} · #${detalhe.registro_id} · ${fmtDataHora(detalhe.em)} · ${detalhe.usuario_email ?? detalhe.origem}`} onFechar={() => setDetalhe(null)}>
          <DetalheRegistro r={detalhe} />
        </Modal>
      )}
    </div>
  )
}

function DetalheRegistro({ r }: { r: Reg }) {
  const chaves = Array.from(new Set([...Object.keys(r.antes ?? {}), ...Object.keys(r.depois ?? {})]))
  const mudou = new Set(r.campos_alterados ?? [])
  const v = (x: any) => (x === null || x === undefined ? '' : typeof x === 'object' ? JSON.stringify(x) : String(x))
  return (
    <>
    {r.operacao === 'UPDATE' && <p className="text-[11px] text-slate-500 mb-2">Nas alterações ficam só os campos alterados (destacados) e os que identificam o registro. A auditoria guarda os últimos 13 meses de registros e 6 meses de logins; o que é mais antigo é apagado automaticamente.</p>}
    <table className="tabela">
      <thead><tr><th className="w-48">Campo</th><th>Antes</th><th>Depois</th></tr></thead>
      <tbody>
        {chaves.map((k) => (
          <tr key={k} className={mudou.has(k) ? 'bg-amber-50 font-semibold' : ''}>
            <td className="font-mono text-[10px]">{k}</td>
            <td className={r.operacao === 'INSERT' ? 'text-slate-300' : ''}>{v(r.antes?.[k])}</td>
            <td className={r.operacao === 'DELETE' ? 'text-slate-300' : ''}>{v(r.depois?.[k])}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </>
  )
}
