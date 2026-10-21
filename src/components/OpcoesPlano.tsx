// <optgroup> por centro de custo do 1º nível com os centros abaixo dele recuados (▲ entrada / ▼ saída). Usar dentro de um <select>.
import { gruposPlano, fmtCodigoCurto } from '@/lib/planoContas'
import type { PlanoConta } from '@/lib/types'

export default function OpcoesPlano({ planos, filtro, atual, comCodigo = false }:
  { planos: PlanoConta[]; filtro?: (c: PlanoConta) => boolean; atual?: number | null; comCodigo?: boolean }) {
  const grupos = gruposPlano(planos, (c) => (c.ativa || c.id === atual) && (!filtro || filtro(c)))
  return (
    <>
      {grupos.map((g) => (
        <optgroup key={g.raiz.id} label={`${g.raiz.tipo === 'ENTRADA' ? '▲' : '▼'} ${g.raiz.nome}`}>
          {g.itens.map(({ c, rotulo }) => <option key={c.id} value={c.id}>{comCodigo ? `${fmtCodigoCurto(c.codigo)} ` : ''}{rotulo}{!c.ativa ? ' (inativo)' : ''}</option>)}
        </optgroup>
      ))}
    </>
  )
}
