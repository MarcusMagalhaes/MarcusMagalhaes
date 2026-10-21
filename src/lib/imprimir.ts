// Abre uma janela só com o documento (sem menu nem filtros), com os estilos da aplicação e cores preservadas.
// O usuário escolhe impressora ou "Salvar como PDF". Sem script inline (CSP): os botões são ligados daqui.
const escapar = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
/** escapa texto vindo do banco antes de entrar no HTML da impressão (a janela tem a mesma origem do site) */
export const escHtml = (s: string | number | null | undefined) => escapar(s == null ? '' : String(s))

/** cabeçalho padrão dos relatórios impressos: empresa, título e período */
export const cabecalhoImpressao = (empresa: string, titulo: string, detalhe?: string) =>
  `<div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #e97d25;padding-bottom:4px;margin-bottom:8px">
     <div><div style="font-size:9pt;color:#64748b">${escHtml(empresa)}</div><h1 style="font-size:14pt;margin:0;color:#24282c">${escHtml(titulo)}</h1>${detalhe ? `<div style="font-size:9pt">${escHtml(detalhe)}</div>` : ''}</div>
     <div style="font-size:8pt;color:#94a3b8">Finanway · ${escHtml(new Date().toLocaleString('pt-BR'))}</div>
   </div>`

export function imprimirHtml(titulo: string, html: string, orientacao: 'landscape' | 'portrait' = 'portrait') {
  const w = window.open('', '_blank', 'width=1100,height=800')
  if (!w) { alert('O navegador bloqueou a janela de impressão. Permita pop-ups para este site.'); return }
  const estilos = Array.from(document.querySelectorAll('link[rel="stylesheet"], style')).map((n) => n.outerHTML).join('\n')
  w.document.open()
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapar(titulo)}</title>${estilos}
<style>
  @page { size: A4 ${orientacao}; margin: 10mm; }
  html, body { background: #fff !important; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: Montserrat, Inter, system-ui, sans-serif; color: #1f2937; padding: 12px; }
  .card { border: 0 !important; box-shadow: none !important; border-radius: 0 !important; padding: 0 !important; overflow: visible !important; }
  table { width: 100% !important; border-collapse: collapse; page-break-inside: auto; }
  thead { display: table-header-group; position: static !important; }
  tr { page-break-inside: avoid; }
  th, td { font-size: 8pt !important; padding: 2px 4px !important; line-height: 1.2; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .no-print { display: none !important; }
  .barra-impressao { position: fixed; top: 8px; right: 8px; display: flex; gap: 6px; }
  .barra-impressao button { font: 600 12px Montserrat, sans-serif; padding: 6px 12px; border-radius: 6px; border: 1px solid #94a3b8; background: #fff; cursor: pointer; }
  .barra-impressao .ok { background: #24282c; color: #fff; border-color: #24282c; }
  @media print { .barra-impressao { display: none; } }
</style></head><body>
<div class="barra-impressao no-print"><button class="fechar">Fechar</button><button class="ok">Imprimir / salvar PDF</button></div>
${html}
</body></html>`)
  w.document.close()
  w.document.querySelector('.barra-impressao .fechar')?.addEventListener('click', () => w.close())
  w.document.querySelector('.barra-impressao .ok')?.addEventListener('click', () => w.print())
  setTimeout(() => { w.focus(); w.print() }, 400)
}
