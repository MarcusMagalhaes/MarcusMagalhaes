import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { registrarPwa } from './lib/pwa'

registrarPwa()

// telas carregam sob demanda: depois de uma publicação os arquivos antigos somem do servidor e quem estava com o app
// aberto não acha a tela pedida — recarrega uma vez para pegar a versão nova (sem laço: no máximo 1 vez a cada 30 s)
window.addEventListener('vite:preloadError', (e) => {
  try {
    const ultima = Number(sessionStorage.getItem('finflow_recarga') ?? 0)
    if (Date.now() - ultima < 30_000) return
    sessionStorage.setItem('finflow_recarga', String(Date.now()))
  } catch { /* sem armazenamento: recarrega assim mesmo */ }
  e.preventDefault()
  window.location.reload()
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
