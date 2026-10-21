// Identidade Finanway (by One Way): public/logo.png (símbolo + FINAN WAY + slogan + "by ONE WAY") e marca.png (só o
// símbolo), gerados por scripts/identidade.py a partir de docs/identidade/finanway-original.jpg. logo.png tem fundo
// transparente, mas o desenho foi feito para fundo carvão: a logo completa vai sempre sobre fundo escuro (bg-grafite-950).
import { useEffect, useState } from 'react'
import { urlImagem } from '@/lib/arquivos'

const base = import.meta.env.BASE_URL
export const SLOGAN = 'Gestão Financeira Inteligente'

export function LogoMark({ size = 40 }: { size?: number }) {
  return <img src={`${base}marca.png`} width={size} height={size} alt="Finanway" className="rounded" style={{ width: size, height: size }} draggable={false} />
}

export default function Logo({ size = 40, className = '' }: { size?: number; className?: string }) {
  return (
    <div className={`flex justify-center ${className}`}>
      <img src={`${base}logo.png`} alt={`Finanway — ${SLOGAN} — by One Way`} draggable={false} style={{ height: size, width: 'auto' }} />
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
