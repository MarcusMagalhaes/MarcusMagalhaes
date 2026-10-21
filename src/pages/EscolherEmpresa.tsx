// Depois do login: "Bem-vindo, Marcus. Em qual empresa deseja entrar?" (só aparece com mais de uma empresa).
// Primeiro acesso do administrador TI, sem nenhuma empresa no banco: formulário para criar a primeira.
import { useState } from 'react'
import Logo, { LogoEmpresa } from '@/components/Logo'
import { useAuth } from '@/lib/auth'
import { supabase, ok } from '@/lib/supabase'
import { erroDocumento } from '@/lib/documento'
import { PAPEIS } from '@/lib/types'

export default function EscolherEmpresa() {
  const { usuario, empresas, escolherEmpresa, sair } = useAuth()
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<number | null>(null)
  const primeiroNome = (usuario?.nome ?? '').split(' ')[0]
  async function escolher(id: number) {
    setErro(null); setOcupado(id)
    try { await escolherEmpresa(id) } catch (e: any) { setErro(e.message) } finally { setOcupado(null) }
  }
  const primeira = usuario?.papel === 'ADMIN_TI' && empresas.length === 0
  return (
    <div className="min-h-full flex flex-col items-center justify-center bg-grafite-950 bg-[radial-gradient(ellipse_at_top,#3a4046_0%,#181b1f_70%)] p-4">
      <Logo size={150} className="mb-4" />
      <div className="card w-full max-w-md p-6 border-t-4 border-t-laranja-500">
        <h1 className="text-lg font-bold text-grafite-900">Bem-vindo, {primeiroNome}!</h1>
        {primeira ? <PrimeiraEmpresa onCriada={(id) => escolher(id)} /> : (
          <>
            <p className="text-sm text-slate-600 mb-4">Em qual empresa você deseja entrar?</p>
            <div className="grid grid-cols-1 gap-2">
              {empresas.map((e) => (
                <button key={e.empresa_id} disabled={ocupado !== null} onClick={() => escolher(e.empresa_id)}
                  className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 text-left hover:border-laranja-500 hover:bg-laranja-50 disabled:opacity-60">
                  <LogoEmpresa caminho={e.logo_caminho} nome={e.nome_fantasia || e.razao_social} tamanho={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold text-grafite-900 truncate">{e.nome_fantasia || e.razao_social}</span>
                    <span className="block text-xs text-slate-500 truncate">{e.nome_fantasia ? `${e.razao_social} · ` : ''}{PAPEIS[e.papel]}</span>
                  </span>
                  <span className="text-laranja-600">{ocupado === e.empresa_id ? '…' : '▶'}</span>
                </button>
              ))}
            </div>
          </>
        )}
        {erro && <div className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">{erro}</div>}
        <button className="mt-4 w-full text-center text-xs text-slate-400 underline" onClick={sair}>Sair e entrar com outra conta</button>
      </div>
    </div>
  )
}

/** primeiro acesso do TI: cria a empresa (já com os centros de custo padrão, Caixa e Conta corrente) e entra nela */
function PrimeiraEmpresa({ onCriada }: { onCriada: (id: number) => void }) {
  const [d, setD] = useState({ razao_social: '', nome_fantasia: '', cnpj: '', diretor_email: '' })
  const [msg, setMsg] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  async function criar() {
    setMsg(null)
    if (!d.razao_social.trim()) { setMsg('Informe a razão social'); return }
    const errDoc = d.cnpj.replace(/\D/g, '').length === 11 ? erroDocumento('PF', d.cnpj) : erroDocumento('PJ', d.cnpj)
    if (errDoc) { setMsg(errDoc); return }
    setSalvando(true)
    try {
      const id = ok(await supabase.rpc('criar_empresa', { p_dados: d })) as number
      onCriada(id)
    } catch (e: any) { setMsg(e.message); setSalvando(false) }
  }
  const campo = (rotulo: string, k: keyof typeof d, extra: Record<string, string> = {}) => (
    <div><label className="label">{rotulo}</label><input className="input" value={d[k]} onChange={(e) => setD({ ...d, [k]: e.target.value })} {...extra} /></div>
  )
  return (
    <div className="ficha mt-1 space-y-2">
      <p className="text-sm text-slate-600">Ainda não há nenhuma empresa cadastrada. Crie a primeira: ela já vem com os centros de custo padrão (entradas e saídas, prontos para a DRE), Caixa e Conta corrente.</p>
      {campo('Razão social', 'razao_social', { autoFocus: 'true' })}
      {campo('Nome fantasia (aparece no menu)', 'nome_fantasia')}
      {campo('CNPJ (ou CPF)', 'cnpj', { inputMode: 'numeric' })}
      {campo('E-mail Google de quem será a Diretoria (opcional)', 'diretor_email', { type: 'email', placeholder: 'diretor@gmail.com' })}
      {msg && <div className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{msg}</div>}
      <button className="btn-accent w-full py-2.5" disabled={salvando} onClick={criar}>{salvando ? 'Criando…' : 'Criar a empresa e entrar'}</button>
    </div>
  )
}
