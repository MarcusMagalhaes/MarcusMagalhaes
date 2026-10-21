// Campos de endereço com busca pelo CEP (ViaCEP): usados no cadastro de clientes/fornecedores e nos dados da empresa.
// Dentro de um grid de 4 colunas (sm:grid-cols-4) de uma `.ficha`. A busca preenche só os campos vazios.
import { useState } from 'react'
import { buscarCep, preencherVazios, type Endereco } from '@/lib/consultas'
import { fmtCep, somenteDigitos } from '@/lib/format'
import { Campo, useToast } from './ui'

export default function EnderecoCampos<T extends Partial<Endereco>>({ valor, onChange, desabilitado }:
  { valor: T; onChange: (novo: T) => void; desabilitado?: boolean }) {
  const { toast } = useToast()
  const [buscando, setBuscando] = useState(false)
  const set = (k: keyof Endereco, v: string) => onChange({ ...valor, [k]: v || null })
  async function procurar() {
    setBuscando(true)
    try {
      const e = await buscarCep(valor.cep ?? '')
      onChange(preencherVazios({ ...valor, cep: somenteDigitos(valor.cep ?? '') } as T, e as Partial<Record<keyof T, string | null>>))
    } catch (e: any) { toast(e.message, 'erro') } finally { setBuscando(false) }
  }
  return (
    <>
      <Campo label="CEP">
        <div className="flex gap-1">
          <input className="input" inputMode="numeric" disabled={desabilitado} value={fmtCep(valor.cep)} maxLength={9}
            onChange={(e) => set('cep', somenteDigitos(e.target.value).slice(0, 8))}
            onBlur={() => { if (somenteDigitos(valor.cep ?? '').length === 8 && !valor.endereco) procurar() }} />
          {!desabilitado && <button type="button" className="btn-secondary shrink-0 px-2" title="Buscar o endereço pelo CEP" disabled={buscando} onClick={procurar}>{buscando ? '…' : '🔍'}</button>}
        </div>
      </Campo>
      <Campo label="Endereço" className="sm:col-span-2"><input className="input" disabled={desabilitado} value={valor.endereco ?? ''} onChange={(e) => set('endereco', e.target.value)} /></Campo>
      <Campo label="Número"><input className="input" disabled={desabilitado} value={valor.numero ?? ''} onChange={(e) => set('numero', e.target.value)} /></Campo>
      <Campo label="Complemento"><input className="input" disabled={desabilitado} value={valor.complemento ?? ''} onChange={(e) => set('complemento', e.target.value)} /></Campo>
      <Campo label="Bairro"><input className="input" disabled={desabilitado} value={valor.bairro ?? ''} onChange={(e) => set('bairro', e.target.value)} /></Campo>
      <Campo label="Cidade"><input className="input" disabled={desabilitado} value={valor.cidade ?? ''} onChange={(e) => set('cidade', e.target.value)} /></Campo>
      <Campo label="UF"><input className="input uppercase" maxLength={2} disabled={desabilitado} value={valor.uf ?? ''} onChange={(e) => set('uf', e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} /></Campo>
    </>
  )
}
