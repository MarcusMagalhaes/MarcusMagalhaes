// Login Google pelo botão oficial (Google Identity Services) direto no site: o Google devolve um ID token à própria
// página e o Supabase o troca por sessão (signInWithIdToken). Assim a tela do Google mostra o site, não o endereço
// do projeto Supabase. Requisito no Google Cloud: a origem do site em "Origens JavaScript autorizadas" do cliente OAuth.

/** Cliente OAuth do Google (público; o mesmo configurado no provedor Google do Supabase). Vem de VITE_GOOGLE_CLIENT_ID. */
export const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? ''

interface GoogleId {
  initialize(cfg: { client_id: string; callback: (r: { credential: string }) => void; nonce?: string; ux_mode?: 'popup'; use_fedcm_for_button?: boolean; itp_support?: boolean }): void
  renderButton(el: HTMLElement, opt: Record<string, unknown>): void
  disableAutoSelect(): void
}
declare global { interface Window { google?: { accounts: { id: GoogleId } } } }

let carregando: Promise<GoogleId> | null = null

/** Carrega o script do Google uma única vez */
export function carregarGoogle(): Promise<GoogleId> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id)
  carregando ??= new Promise((ok, falha) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => (window.google?.accounts?.id ? ok(window.google.accounts.id) : falha(new Error('Google indisponível')))
    s.onerror = () => { carregando = null; falha(new Error('Não foi possível carregar o login do Google')) }
    document.head.appendChild(s)
  })
  return carregando
}

/** Par de nonce: o bruto vai ao Supabase, o hash SHA-256 (hex) vai ao Google e volta dentro do token */
export async function novoNonce(): Promise<{ bruto: string; hash: string }> {
  const bruto = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
  const dig = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bruto))
  const hash = Array.from(new Uint8Array(dig)).map((b) => b.toString(16).padStart(2, '0')).join('')
  return { bruto, hash }
}
