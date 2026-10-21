// PWA: registro do service worker e o convite "Instalar app" (Android/Chrome/Edge). No iPhone não há convite
// automático: a dica é Compartilhar › Adicionar à Tela de Início.
import { useEffect, useState } from 'react'

interface EventoInstalar extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
let adiado: EventoInstalar | null = null
const ouvintes = new Set<() => void>()
const avisar = () => ouvintes.forEach((f) => f())

export function registrarPwa() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* sem PWA: o site segue normal */ }) })
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); adiado = e as EventoInstalar; avisar() })
  window.addEventListener('appinstalled', () => { adiado = null; avisar() })
}

/** já está aberto como app instalado? */
export const instalado = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true

/** marca (sessionStorage) da janela que o app instalado no iPhone abre só para o login com o Google (Luminexus 1.1.025) */
export const CHAVE_JANELA_LOGIN = 'finanway_janela_login'
/** esta janela foi aberta pelo app instalado só para concluir o login? (não mostra o app: conclui, avisa e se fecha) */
export function ehJanelaLogin() { try { return sessionStorage.getItem(CHAVE_JANELA_LOGIN) === '1' } catch { return false } }
const ehIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent)

/** o que mostrar: 'prompt' (botão instala direto), 'ios' (dica manual) ou null */
export function useInstalarApp() {
  const [, forcar] = useState(0)
  useEffect(() => { const f = () => forcar((n) => n + 1); ouvintes.add(f); return () => { ouvintes.delete(f) } }, [])
  const modo: 'prompt' | 'ios' | null = instalado() ? null : adiado ? 'prompt' : ehIOS() ? 'ios' : null
  async function instalar() {
    if (!adiado) return
    await adiado.prompt()
    await adiado.userChoice.catch(() => null)
    adiado = null; avisar()
  }
  return { modo, instalar }
}
