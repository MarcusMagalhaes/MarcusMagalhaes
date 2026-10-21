// Incrementa a versão do build em src/versao.ts (último grupo: 1.0.000 → 1.0.001) e imprime a nova.
// Os dois primeiros grupos só mudam a pedido: node scripts/versao.mjs 1.1.000
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const arq = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'versao.ts')
const txt = readFileSync(arq, 'utf8')
const m = txt.match(/VERSAO = '(\d+)\.(\d+)\.(\d{3})'/)
if (!m) { console.error('src/versao.ts sem VERSAO no formato X.Y.ZZZ'); process.exit(1) }
let nova = process.argv[2]
if (nova) {
  if (!/^\d+\.\d+\.\d{3}$/.test(nova)) { console.error('formato esperado: X.Y.ZZZ (ex.: 1.1.000)'); process.exit(1) }
} else {
  nova = `${m[1]}.${m[2]}.${String(Number(m[3]) + 1).padStart(3, '0')}`
}
writeFileSync(arq, txt.replace(m[0], `VERSAO = '${nova}'`))
console.log(nova)
