// Identidade FinFlow: public/logo.png (símbolo + FINFLOW) e marca.png (só o símbolo), gerados por scripts/identidade.py a
// partir de docs/identidade/finflow-original.jpg. O slogan vai em texto (na arte original ele saiu cortado).
import { useEffect, useState } from 'react'
import { urlImagem } from '@/lib/arquivos'

const base = import.meta.env.BASE_URL
export const SLOGAN = 'Gestão Financeira Inteligente'

export function LogoMark({ size = 40 }: { size?: number }) {
  return <img src={`${base}marca.png`} width={size} height={size} alt="FinFlow" style={{ width: size, height: size }} draggable={false} />
}

export default function Logo({ size = 40, className = '', slogan = false }: { size?: number; className?: string; slogan?: boolean }) {
  return (
    <div className={`flex flex-col items-center ${className}`}>
      <img src={`${base}logo.png`} alt="FinFlow" draggable={false} style={{ height: size, width: 'auto' }} />
      {slogan && <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-grafite-700">{SLOGAN}</div>}
    </div>
  )
}

/** logo da empresa (bucket 'logos'); sem logo, as iniciais num quadrado grafite */
export function LogoEmpresa({ caminho, nome, tamanho = 40 }: { caminho: string | null | undefined; nome: string; tamanho?: number }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => { let vivo = true; urlImagem('logos', caminho).then((u) => { if (vivo) setUrl(u) }); return () => { vivo = false } }, [caminho])
  const iniciais = nome.split(/\s+/).filter((p) => p.length > 2 || /^[A-Z]/.test(p)).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?'
  return url
    ? <img src={url} alt={nome} className="shrink-0 rounded-lg border border-slate-200 bg-white object-contain" style={{ width: tamanho, height: tamanho }} />
    : <div className="flex shrink-0 items-center justify-center rounded-lg bg-grafite-900 font-extrabold text-white" style={{ width: tamanho, height: tamanho, fontSize: tamanho * 0.38 }}>{iniciais}</div>
}
