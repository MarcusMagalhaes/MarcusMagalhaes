import { describe, expect, it } from 'vitest'
import { capitalizar, mapearCep, mapearCnpj, preencherVazios } from './consultas'

describe('consultas', () => {
  it('mapeia o CNPJ da BrasilAPI', () => {
    const d = mapearCnpj({
      razao_social: 'ALFA COMERCIO LTDA', nome_fantasia: 'ALFA DAS FLORES', descricao_tipo_de_logradouro: 'RUA', logradouro: 'DAS ACACIAS',
      numero: '105', complemento: '', bairro: 'CENTRO', municipio: 'IPATINGA', uf: 'mg', cep: '35160-000', ddd_telefone_1: '3138221234', email: 'CONTATO@ALFA.COM',
    })
    expect(d.nome).toBe('ALFA COMERCIO LTDA')
    expect(d.nome_fantasia).toBe('Alfa das Flores')
    expect(d.endereco).toBe('Rua das Acacias')
    expect(d.complemento).toBeNull()
    expect(d.cidade).toBe('Ipatinga')
    expect(d.uf).toBe('MG')
    expect(d.cep).toBe('35160000')
    expect(d.telefone).toBe('3138221234')
    expect(d.email).toBe('contato@alfa.com')
  })
  it('não repete o tipo do logradouro', () => {
    expect(mapearCnpj({ descricao_tipo_de_logradouro: 'RUA', logradouro: 'RUA MESSINA' }).endereco).toBe('Rua Messina')
  })
  it('mapeia o CEP do ViaCEP', () => {
    expect(mapearCep({ logradouro: 'Rua Messina', bairro: 'Bethânia', localidade: 'Ipatinga', uf: 'MG' })).toEqual({ endereco: 'Rua Messina', bairro: 'Bethânia', cidade: 'Ipatinga', uf: 'MG' })
    expect(mapearCep({ erro: true })).toBeNull()
  })
  it('preenche só o que está vazio', () => {
    expect(preencherVazios({ nome: 'Digitado', cidade: '' as string | null, uf: null as string | null }, { nome: 'Receita', cidade: 'Ipatinga', uf: null }))
      .toEqual({ nome: 'Digitado', cidade: 'Ipatinga', uf: null })
  })
  it('capitaliza', () => {
    expect(capitalizar('AVENIDA DO CONTORNO')).toBe('Avenida do Contorno')
    expect(capitalizar(null)).toBeNull()
  })
})
