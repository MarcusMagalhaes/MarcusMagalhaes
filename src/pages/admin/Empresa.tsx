// Empresa em uso: dados cadastrais (com busca do CNPJ na Receita e do CEP), logo e a configuração da baixa de títulos
// (centros de custo para juros/multa e descontos — 0003, baixar_titulo). O administrador TI vê também todas as empresas:
// cria (criar_empresa já semeia os centros de custo, caixa e conta corrente e libera o diretor), entra
// numa delas, ativa e desativa.
import { useEffect, useRef, useState } from 'react'
import { supabase, ok } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { listarPlano, rpc } from '@/lib/dados'
import { carregarDadosEmpresa } from '@/lib/empresa'
import { ACEITA, enviarArquivo, esquecerImagem, removerArquivo, validarArquivo } from '@/lib/arquivos'
import { buscarCnpj, preencherVazios } from '@/lib/consultas'
import { erroDocumento, fmtDocumento } from '@/lib/documento'
import { fmtData, fmtTelefone, somenteDigitos } from '@/lib/format'
import { ehAdminTI, REGIMES, type Empresa as TEmpresa, type PlanoConta, type RegimeTributario } from '@/lib/types'
import { Bloco, Campo, Carregando, Chip, Confirmar, Modal, Opcoes, Titulo, useToast } from '@/components/ui'
import { LogoEmpresa } from '@/components/Logo'
import EnderecoCampos from '@/components/EnderecoCampos'
import OpcoesPlano from '@/components/OpcoesPlano'

const COLUNAS_DADOS = ['razao_social', 'nome_fantasia', 'cnpj', 'inscricao_estadual', 'inscricao_municipal', 'regime_tributario', 'cep', 'endereco', 'numero',
  'complemento', 'bairro', 'cidade', 'uf', 'telefone', 'email', 'site'] as const
type ConfigBaixa = Pick<TEmpresa, 'plano_juros_pagos_id' | 'plano_juros_recebidos_id' | 'plano_descontos_obtidos_id' | 'plano_descontos_concedidos_id'>
const CONFIG: { campo: keyof ConfigBaixa; rotulo: string; tipo: 'ENTRADA' | 'SAIDA'; ajuda: string }[] = [
  { campo: 'plano_juros_pagos_id', rotulo: 'Juros e multas pagos', tipo: 'SAIDA', ajuda: 'conta a pagar quitada com atraso' },
  { campo: 'plano_juros_recebidos_id', rotulo: 'Juros e multas recebidos', tipo: 'ENTRADA', ajuda: 'cliente pagou com atraso' },
  { campo: 'plano_descontos_obtidos_id', rotulo: 'Descontos obtidos', tipo: 'ENTRADA', ajuda: 'fornecedor deu desconto' },
  { campo: 'plano_descontos_concedidos_id', rotulo: 'Descontos concedidos', tipo: 'SAIDA', ajuda: 'desconto dado ao cliente' },
]

/** dados cadastrais (os mesmos campos na empresa em uso e na nova empresa do TI) */
function CamposEmpresa({ e, set, desabilitado }: { e: Partial<TEmpresa>; set: (e: Partial<TEmpresa>) => void; desabilitado?: boolean }) {
  const { toast } = useToast()
  const [buscando, setBuscando] = useState(false)
  const cnpj = somenteDigitos(e.cnpj ?? '')
  const erro = cnpj.length === 14 ? erroDocumento('PJ', cnpj) : cnpj.length === 11 ? erroDocumento('PF', cnpj) : null
  async function consultar() {
    setBuscando(true)
    try {
      const d = await buscarCnpj(cnpj)
      const { nome, ...resto } = d
      set(preencherVazios({ ...e }, { ...resto, razao_social: nome } as Partial<Record<keyof TEmpresa, string | null>>))
      toast('Dados da Receita preenchidos nos campos vazios', 'info')
    } catch (x: any) { toast(x.message, 'erro') } finally { setBuscando(false) }
  }
  const txt = (k: keyof TEmpresa, rotulo: string, className = '') => (
    <Campo label={rotulo} className={className}><input className="input" disabled={desabilitado} value={(e[k] as string | null) ?? ''} onChange={(ev) => set({ ...e, [k]: ev.target.value })} /></Campo>
  )
  return (
    <>
      <Campo label="CNPJ (ou CPF do MEI/produtor)">
        <div className="flex gap-1">
          <input className={`input tabular-nums ${erro ? 'border-red-500' : ''}`} inputMode="numeric" disabled={desabilitado} value={fmtDocumento(cnpj)} onChange={(ev) => set({ ...e, cnpj: somenteDigitos(ev.target.value).slice(0, 14) })} />
          {!desabilitado && <button type="button" className="btn-secondary shrink-0 px-2" title="Buscar os dados na Receita (BrasilAPI)" disabled={buscando || cnpj.length !== 14 || !!erro} onClick={consultar}>{buscando ? '…' : '🔍'}</button>}
        </div>
        {erro && <span className="text-[10px] font-semibold text-red-600">{erro}</span>}
      </Campo>
      {txt('razao_social', 'Razão social', 'sm:col-span-2')}
      {txt('nome_fantasia', 'Nome fantasia (aparece no menu)')}
      {txt('inscricao_estadual', 'Inscrição estadual')}
      {txt('inscricao_municipal', 'Inscrição municipal')}
      <Campo label="Regime tributário" className="sm:col-span-2"><Opcoes valor={e.regime_tributario} opcoes={REGIMES} disabled={desabilitado} onChange={(v) => set({ ...e, regime_tributario: (v || null) as RegimeTributario | null })} vazio="—" /></Campo>
      <EnderecoCampos valor={e} onChange={set} desabilitado={desabilitado} />
      <Campo label="Telefone"><input className="input" inputMode="tel" disabled={desabilitado} value={fmtTelefone(e.telefone)} onChange={(ev) => set({ ...e, telefone: somenteDigitos(ev.target.value).slice(0, 11) })} /></Campo>
      {txt('email', 'E-mail')}
      {txt('site', 'Site', 'sm:col-span-2')}
    </>
  )
}

const limpar = (e: Partial<TEmpresa>) => Object.fromEntries(COLUNAS_DADOS.map((k) => [k, typeof e[k] === 'string' ? ((e[k] as string).trim() || null) : e[k] ?? null]))

export default function EmpresaPagina() {
  const { toast } = useToast()
  const { empresa: acesso, perfil, recarregar, escolherEmpresa } = useAuth()
  const ti = ehAdminTI(perfil)
  const [e, setE] = useState<TEmpresa | null>(null)
  const [planos, setPlanos] = useState<PlanoConta[]>([])
  const [config, setConfig] = useState<ConfigBaixa | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [tirarLogo, setTirarLogo] = useState(false)
  const [todas, setTodas] = useState<TEmpresa[]>([])
  const [nova, setNova] = useState<(Partial<TEmpresa> & { diretor_email?: string; diretor_nome?: string }) | null>(null)
  const [alternar, setAlternar] = useState<TEmpresa | null>(null)
  const arquivo = useRef<HTMLInputElement>(null)
  const id = acesso?.empresa_id

  const carregar = async () => {
    if (!id) return
    try {
      const d = ok(await supabase.from('empresa').select('*').eq('id', id).single()) as TEmpresa
      setE(d)
      setConfig({ plano_juros_pagos_id: d.plano_juros_pagos_id, plano_juros_recebidos_id: d.plano_juros_recebidos_id, plano_descontos_obtidos_id: d.plano_descontos_obtidos_id, plano_descontos_concedidos_id: d.plano_descontos_concedidos_id })
      setPlanos(await listarPlano(true))
      if (ti) setTodas(ok(await supabase.from('empresa').select('*').order('razao_social')) as TEmpresa[])
    } catch (x: any) { toast(x.message, 'erro') }
  }
  useEffect(() => { carregar() }, [id])
  const depoisDeSalvar = async () => { await carregarDadosEmpresa(id ?? null); await recarregar(); await carregar() }

  async function salvarDados() {
    if (!e?.razao_social?.trim()) { toast('Informe a razão social', 'erro'); return }
    const doc = somenteDigitos(e.cnpj ?? '')
    if (doc && (doc.length === 14 ? erroDocumento('PJ', doc) : doc.length === 11 ? erroDocumento('PF', doc) : 'CNPJ/CPF incompleto')) { toast('CNPJ/CPF inválido', 'erro'); return }
    setSalvando(true)
    try { ok(await supabase.from('empresa').update(limpar(e)).eq('id', e.id)); toast('Dados da empresa salvos'); await depoisDeSalvar() }
    catch (x: any) { toast(x.message, 'erro') } finally { setSalvando(false) }
  }
  async function salvarConfig() {
    if (!e || !config) return
    try { ok(await supabase.from('empresa').update(config).eq('id', e.id)); toast('Configuração da baixa salva'); await carregarDadosEmpresa(e.id) }
    catch (x: any) { toast(x.message, 'erro') }
  }
  async function trocarLogo(f: File | undefined) {
    if (arquivo.current) arquivo.current.value = ''
    if (!f || !e) return
    const erro = validarArquivo('logos', f)
    if (erro && !/maior que/.test(erro)) { toast(erro, 'erro'); return }   // imagem grande é reduzida no envio
    try {
      const env = await enviarArquivo('logos', 'logo', f)
      ok(await supabase.from('empresa').update({ logo_caminho: env.caminho }).eq('id', e.id))
      if (e.logo_caminho) { await removerArquivo('logos', e.logo_caminho).catch(() => {}); esquecerImagem('logos', e.logo_caminho) }
      toast('Logo atualizada'); await depoisDeSalvar()
    } catch (x: any) { toast(x.message, 'erro') }
  }
  async function removerLogo() {
    setTirarLogo(false)
    if (!e?.logo_caminho) return
    try {
      ok(await supabase.from('empresa').update({ logo_caminho: null }).eq('id', e.id))
      await removerArquivo('logos', e.logo_caminho).catch(() => {}); esquecerImagem('logos', e.logo_caminho)
      toast('Logo removida'); await depoisDeSalvar()
    } catch (x: any) { toast(x.message, 'erro') }
  }
  async function criar() {
    if (!nova?.razao_social?.trim()) { toast('Informe a razão social', 'erro'); return }
    const email = nova.diretor_email?.trim().toLowerCase() ?? ''
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('E-mail do diretor inválido', 'erro'); return }
    setSalvando(true)
    try {
      const novoId = await rpc<number>('criar_empresa', { p_dados: { ...limpar(nova), diretor_email: email || null, diretor_nome: nova.diretor_nome?.trim() || null } })
      toast('Empresa criada com os centros de custo padrão. Você já está nela.')
      setNova(null)
      await escolherEmpresa(novoId)
    } catch (x: any) { toast(x.message, 'erro') } finally { setSalvando(false) }
  }
  async function confirmarAlternar() {
    const x = alternar; setAlternar(null)
    if (!x) return
    try { ok(await supabase.from('empresa').update({ ativa: !x.ativa }).eq('id', x.id)); toast(x.ativa ? 'Empresa desativada' : 'Empresa ativada'); carregar() }
    catch (y: any) { toast(y.message, 'erro') }
  }

  if (!e || !config) return <Carregando />
  const configIncompleta = CONFIG.some((c) => !config[c.campo])
  return (
    <div className="mx-auto max-w-4xl space-y-1.5">
      <Titulo>{ti ? 'Empresas' : 'Empresa'}</Titulo>

      <Bloco className="p-3" titulo="Dados da empresa em uso" abertoInicial>
        <div className="mb-3 flex items-center gap-3">
          <LogoEmpresa caminho={e.logo_caminho} nome={e.nome_fantasia || e.razao_social} tamanho={64} />
          <div className="flex flex-wrap gap-1.5">
            <button className="btn-secondary" onClick={() => arquivo.current?.click()}>{e.logo_caminho ? 'Trocar logo' : 'Enviar logo'}</button>
            {e.logo_caminho && <button className="btn-secondary text-red-700" onClick={() => setTirarLogo(true)}>Remover logo</button>}
            <input ref={arquivo} type="file" accept={ACEITA.logos} className="hidden" onChange={(x) => trocarLogo(x.target.files?.[0])} />
          </div>
          <span className="text-[11px] text-slate-500">PNG, JPG ou WEBP até 2 MB (quadrada fica melhor). Aparece no menu e nas impressões.</span>
        </div>
        <div className="ficha grid grid-cols-1 gap-2 sm:grid-cols-4">
          <CamposEmpresa e={e} set={(x) => setE({ ...e, ...x })} />
          <div className="acoes sm:col-span-4 flex justify-end"><button className="btn-primary" disabled={salvando} onClick={salvarDados}>{salvando ? 'Salvando…' : 'Salvar dados'}</button></div>
        </div>
      </Bloco>

      <Bloco className="p-3" titulo="Configuração da baixa de títulos" abertoInicial={configIncompleta} extra={configIncompleta ? <span className="ml-2 text-amber-700">· incompleta</span> : null}>
        <p className="mb-2 text-xs text-slate-600">
          Ao baixar uma conta a pagar ou a receber, os <b>juros/multa</b> e os <b>descontos</b> viram lançamentos à parte, nestes centros de custo,
          para a DRE mostrar cada coisa no lugar certo (o valor do título fica na conta dele). Sem a conta definida, a baixa com juros ou desconto é recusada.
        </p>
        <div className="ficha grid grid-cols-1 gap-2 sm:grid-cols-2">
          {CONFIG.map((c) => (
            <Campo key={c.campo} label={`${c.rotulo} (${c.ajuda})`}>
              <select className="input" value={config[c.campo] ?? ''} onChange={(x) => setConfig({ ...config, [c.campo]: x.target.value ? Number(x.target.value) : null })}>
                <option value="">— escolha —</option>
                <OpcoesPlano planos={planos} filtro={(p) => p.tipo === c.tipo} atual={config[c.campo]} comCodigo />
              </select>
            </Campo>
          ))}
          <div className="acoes sm:col-span-2 flex justify-end"><button className="btn-primary" onClick={salvarConfig}>Salvar configuração</button></div>
        </div>
      </Bloco>

      {ti && (
        <Bloco className="p-3" titulo="Todas as empresas (administrador TI)" contador={todas.length} abertoInicial
          acoes={<button className="btn-primary py-1" onClick={() => setNova({ regime_tributario: 'SIMPLES' })}>+ Nova empresa</button>}>
          <div className="overflow-auto">
            <table className="tabela">
              <thead><tr><th>Empresa</th><th>CNPJ</th><th>Cidade</th><th>Criada em</th><th>Situação</th><th></th></tr></thead>
              <tbody>
                {todas.map((x) => (
                  <tr key={x.id} className={x.ativa ? '' : 'text-slate-400'}>
                    <td className="font-semibold">{x.nome_fantasia || x.razao_social}{x.nome_fantasia && <span className="ml-1 text-[10px] font-normal text-slate-400">{x.razao_social}</span>}{x.id === id && <span className="ml-1"><Chip cor="azul">em uso</Chip></span>}</td>
                    <td className="whitespace-nowrap tabular-nums">{fmtDocumento(x.cnpj)}</td>
                    <td>{[x.cidade, x.uf].filter(Boolean).join('/')}</td>
                    <td>{fmtData(x.criado_em)}</td>
                    <td>{x.ativa ? <Chip cor="verde">ativa</Chip> : <Chip cor="vermelho">desativada</Chip>}</td>
                    <td className="whitespace-nowrap text-right">
                      {x.ativa && x.id !== id && <button className="btn-secondary mr-1 py-0.5" onClick={() => escolherEmpresa(x.id).catch((y) => toast(y.message, 'erro'))}>Entrar</button>}
                      {x.id !== id && <button className="btn-secondary py-0.5" onClick={() => setAlternar(x)}>{x.ativa ? 'Desativar' : 'Ativar'}</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">Empresa desativada some para todos os usuários dela (os dados ficam guardados). A empresa nova já nasce com os centros de custo padrão, Caixa e Conta corrente.</p>
        </Bloco>
      )}

      {nova && (
        <Modal aberto titulo="Nova empresa" onFechar={() => setNova(null)}>
          <div className="mx-auto max-w-4xl">
            <div className="ficha grid grid-cols-1 gap-2 sm:grid-cols-4">
              <CamposEmpresa e={nova} set={(x) => setNova({ ...nova, ...x })} />
              <div className="sm:col-span-4 mt-2 label">Diretor (primeiro acesso)</div>
              <Campo label="E-mail Google do diretor" className="sm:col-span-2"><input className="input" type="email" value={nova.diretor_email ?? ''} onChange={(x) => setNova({ ...nova, diretor_email: x.target.value })} placeholder="dono@empresa.com.br" /></Campo>
              <Campo label="Nome do diretor" className="sm:col-span-2"><input className="input" value={nova.diretor_nome ?? ''} onChange={(x) => setNova({ ...nova, diretor_nome: x.target.value })} /></Campo>
              <p className="sm:col-span-4 text-[11px] text-slate-500">O diretor entra com esse e-mail Google e já tem acesso; depois ele mesmo libera o financeiro e o contador em Usuários.</p>
              <div className="acoes sm:col-span-4 flex justify-end gap-2">
                <button className="btn-secondary" onClick={() => setNova(null)}>Cancelar</button>
                <button className="btn-primary" disabled={salvando} onClick={criar}>{salvando ? 'Criando…' : 'Criar empresa'}</button>
              </div>
            </div>
          </div>
        </Modal>
      )}
      <Confirmar aberto={tirarLogo} perigo titulo="Remover logo" texto="Remover a logo da empresa?" onNao={() => setTirarLogo(false)} onSim={removerLogo} />
      <Confirmar aberto={!!alternar} perigo={!!alternar?.ativa} titulo={alternar?.ativa ? 'Desativar empresa' : 'Ativar empresa'}
        texto={alternar?.ativa ? `Desativar ${alternar.nome_fantasia || alternar.razao_social}? Ninguém mais entra nela até ser ativada de novo (os dados ficam guardados).` : `Ativar ${alternar?.nome_fantasia || alternar?.razao_social}?`}
        onNao={() => setAlternar(null)} onSim={confirmarAlternar} />
    </div>
  )
}
