import { describe, expect, it } from 'vitest'
import { lerCSV, lerExtrato, lerOFX } from './extrato'

describe('extrato', () => {
  it('lê OFX (SGML) com FITID', () => {
    const ofx = `OFXHEADER:100\n<OFX><BANKTRANLIST>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261018120000[-3:BRT]<TRNAMT>480.00<FITID>abc1<MEMO>PIX RECEBIDO
</STMTTRN><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261019<TRNAMT>-99.90<FITID>abc2<NAME>TARIFA<MEMO>PACOTE
</STMTTRN></BANKTRANLIST></OFX>`
    const l = lerOFX(ofx)
    expect(l).toHaveLength(2)
    expect(l[0]).toMatchObject({ extrato_id: 'ofx:abc1', data: '2026-10-18', valor: 480, descricao: 'PIX RECEBIDO' })
    expect(l[1]).toMatchObject({ valor: -99.9, descricao: 'TARIFA – PACOTE' })
    expect(lerExtrato('x.ofx', ofx).formato).toBe('OFX')
  })
  it('lê CSV com cabeçalho e vírgula decimal', () => {
    const csv = 'Data;Histórico;Valor\n18/10/2026;PIX RECEBIDO;1.480,00\n19/10/2026;TARIFA;-99,90\n'
    const l = lerCSV(csv)
    expect(l.map((x) => x.valor)).toEqual([1480, -99.9])
    expect(l[0].data).toBe('2026-10-18')
    expect(l[0].extrato_id).toMatch(/^h:/)
  })
  it('lê CSV com débito e crédito separados', () => {
    const l = lerCSV('data,descricao,debito,credito\n2026-10-01,Energia,150.00,\n2026-10-02,Venda,,300.00\n')
    expect(l.map((x) => x.valor)).toEqual([-150, 300])
  })
})

describe('extrato: transações iguais no mesmo arquivo', () => {
  it('numera as repetições em vez de descartar', () => {
    const { linhas } = lerExtrato('x.csv', 'Data;Descrição;Valor\n18/10/2026;PIX JOAO;50,00\n18/10/2026;PIX JOAO;50,00\n')
    expect(linhas).toHaveLength(2)
    expect(linhas[1].extrato_id).toBe(`${linhas[0].extrato_id}#2`)
  })
})
