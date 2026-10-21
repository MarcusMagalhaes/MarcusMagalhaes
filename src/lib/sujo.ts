// Alterações não salvas: aviso do navegador ao fechar/recarregar a aba e confirmação ao fechar a ficha.
import { useEffect } from 'react'

/** enquanto houver alteração não salva, o navegador pergunta antes de fechar ou recarregar a aba */
export function useAvisoSaida(sujo: boolean) {
  useEffect(() => {
    if (!sujo) return
    const h = (ev: BeforeUnloadEvent) => { ev.preventDefault(); ev.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [sujo])
}

/** true se pode fechar: sem alterações, ou a pessoa confirmou descartar */
export const podeDescartar = (sujo: boolean, texto = 'Há alterações não salvas. Fechar e descartar?') => !sujo || window.confirm(texto)

/** compara dois objetos de formulário (vazio, null e undefined contam como iguais) */
export const mudou = (a: object, b: object) => {
  const norm = (o: object) => JSON.stringify(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== '').sort(([x], [y]) => x.localeCompare(y))))
  return norm(a) !== norm(b)
}
