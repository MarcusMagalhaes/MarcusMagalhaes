// Depois do login: "Bem-vindo, Marcus. Em qual empresa deseja entrar?" (só aparece com mais de uma empresa)
import { useState } from 'react'
import Logo, { LogoEmpresa } from '@/components/Logo'
import { useAuth } from '@/lib/auth'
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
  return (
    <div className="min-h-full flex flex-col items-center justify-center bg-grafite-950 bg-[radial-gradient(ellipse_at_top,#3a4046_0%,#181b1f_70%)] p-4">
      <Logo size={150} className="mb-4" />
      <div className="card w-full max-w-md p-6 border-t-4 border-t-laranja-500">
        <h1 className="text-lg font-bold text-grafite-900">Bem-vindo, {primeiroNome}!</h1>
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
        {erro && <div className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">{erro}</div>}
        <button className="mt-4 w-full text-center text-xs text-slate-400 underline" onClick={sair}>Sair e entrar com outra conta</button>
      </div>
    </div>
  )
}
