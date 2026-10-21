import { useSyncExternalStore } from 'react'

/** mesmo corte do `lg:` do Tailwind (1024 px): abaixo disso as telas empilham os blocos */
const TELA_GRANDE = '(min-width: 1024px)'

function assinar(avisar: () => void) {
  const m = window.matchMedia(TELA_GRANDE)
  m.addEventListener('change', avisar)
  return () => m.removeEventListener('change', avisar)
}

/** true no computador (lg+), false no celular e no tablet em pé; acompanha a rotação e o redimensionamento */
export function useTelaGrande() {
  return useSyncExternalStore(assinar, () => window.matchMedia(TELA_GRANDE).matches)
}
