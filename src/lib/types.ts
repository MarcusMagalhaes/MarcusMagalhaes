// Tipos e listas de domínio (espelham os checks do banco em supabase/migrations/)

// ---------- Papéis ----------
/** Papel na empresa em uso. ADMIN_TI é global (conta de TI, qualquer empresa); os demais vêm de usuario_empresa */
export type Papel = 'ADMIN_TI' | 'DIRETOR' | 'ADMIN' | 'FINANCEIRO' | 'FINANCEIRO_AUX' | 'CONTADOR'
export const PAPEIS: Record<Papel, string> = {
  ADMIN_TI: 'Administrador TI', DIRETOR: 'Diretoria', ADMIN: 'Administrador', FINANCEIRO: 'Financeiro',
  FINANCEIRO_AUX: 'Auxiliar financeiro', CONTADOR: 'Contador',
}
/** Papéis que o administrador de uma empresa atribui (ADMIN_TI só pelo banco; DIRETOR só a diretoria dá) */
export type PapelEmpresa = Exclude<Papel, 'ADMIN_TI'>
export const PAPEIS_EMPRESA: Record<PapelEmpresa, string> = {
  DIRETOR: PAPEIS.DIRETOR, ADMIN: PAPEIS.ADMIN, FINANCEIRO: PAPEIS.FINANCEIRO, FINANCEIRO_AUX: PAPEIS.FINANCEIRO_AUX, CONTADOR: PAPEIS.CONTADOR,
}
/** o que cada papel libera (tela Usuários) — o banco confere tudo de novo (0001: eh_admin, eh_financeiro…) */
export const PAPEL_PARA: Record<PapelEmpresa, string> = {
  DIRETOR: 'Tudo, inclusive reabrir um mês fechado e dar o papel Diretoria',
  ADMIN: 'Usuários, dados da empresa e auditoria, e o financeiro completo',
  FINANCEIRO: 'Financeiro completo: lançamentos, contas a pagar e receber, conciliação, cadastros, orçamento e fechamento do mês',
  FINANCEIRO_AUX: 'Lança, baixa títulos, importa extrato e anexa documentos; não exclui, não fecha o mês nem altera cadastros',
  CONTADOR: 'Consulta tudo do financeiro, relatórios e exportações; dá o parecer do fechamento do mês',
}
type ComPapel = { papel: Papel } | null | undefined
export const ehAdminTI = (u: ComPapel) => u?.papel === 'ADMIN_TI'
/** usuários, empresa e auditoria */
export const ehAdmin = (u: ComPapel) => u?.papel === 'ADMIN_TI' || u?.papel === 'DIRETOR' || u?.papel === 'ADMIN'
/** reabrir mês fechado */
export const ehDiretor = (u: ComPapel) => u?.papel === 'ADMIN_TI' || u?.papel === 'DIRETOR'
/** financeiro completo: excluir, cadastros, orçamento, fechar o mês, estornar baixa */
export const ehFinanceiro = (u: ComPapel) => ehAdmin(u) || u?.papel === 'FINANCEIRO'
/** operação: lançar, baixar títulos, importar extrato, anexar, cadastrar cliente/fornecedor */
export const ehOperador = (u: ComPapel) => ehFinanceiro(u) || u?.papel === 'FINANCEIRO_AUX'
/** leitura do financeiro e relatórios (todos os papéis) */
export const ehLeitor = (u: ComPapel) => ehOperador(u) || u?.papel === 'CONTADOR'
/** parecer do fechamento */
export const ehContador = (u: ComPapel) => u?.papel === 'ADMIN_TI' || u?.papel === 'CONTADOR'

// ---------- Contas de login e empresas ----------
/** Conta de login (global). O papel por empresa está em EmpresaAcesso */
export interface Usuario { id: string; nome: string; email: string; papel: 'ADMIN_TI' | 'USUARIO'; ativo: boolean; empresa_atual_id: number | null }
/** Empresa em que o usuário pode entrar, com o papel dele nela (função minhas_empresas) */
export interface EmpresaAcesso { empresa_id: number; razao_social: string; nome_fantasia: string | null; papel: Papel; logo_caminho: string | null }
export type RegimeTributario = 'MEI' | 'SIMPLES' | 'LUCRO_PRESUMIDO' | 'LUCRO_REAL' | 'ISENTO' | 'OUTRO'
export const REGIMES: Record<RegimeTributario, string> = {
  MEI: 'MEI', SIMPLES: 'Simples Nacional', LUCRO_PRESUMIDO: 'Lucro Presumido', LUCRO_REAL: 'Lucro Real', ISENTO: 'Isento / imune (terceiro setor)', OUTRO: 'Outro',
}
export interface Empresa {
  id: number; razao_social: string; nome_fantasia: string | null; cnpj: string | null; inscricao_estadual: string | null; inscricao_municipal: string | null
  regime_tributario: RegimeTributario | null
  cep: string | null; endereco: string | null; numero: string | null; complemento: string | null; bairro: string | null; cidade: string | null; uf: string | null
  telefone: string | null; email: string | null; site: string | null; logo_caminho: string | null; ativa: boolean; criado_em: string
  /** centros de custo usados na baixa de títulos (0002): juros/multa e descontos */
  plano_juros_pagos_id: number | null; plano_juros_recebidos_id: number | null; plano_descontos_obtidos_id: number | null; plano_descontos_concedidos_id: number | null
}
export interface UsuarioEmpresa {
  usuario_id: string; empresa_id: number; papel: PapelEmpresa; ativo: boolean; criado_em: string
  usuario?: { nome: string; email: string; papel: 'ADMIN_TI' | 'USUARIO' }
}
export interface LiberacaoPrevia { empresa_id: number; email: string; papel: PapelEmpresa; nome: string | null; criado_em: string; usada_em: string | null }

// ---------- Cadastros ----------
export type TipoConta = 'CAIXA' | 'CONTA_CORRENTE' | 'POUPANCA' | 'APLICACAO' | 'CARTAO_CREDITO' | 'OUTRA'
export const TIPOS_CONTA: Record<TipoConta, string> = {
  CAIXA: 'Caixa (dinheiro)', CONTA_CORRENTE: 'Conta corrente', POUPANCA: 'Poupança', APLICACAO: 'Aplicação', CARTAO_CREDITO: 'Cartão de crédito', OUTRA: 'Outra',
}
export interface ContaFinanceira {
  id: number; nome: string; tipo: TipoConta; banco: string | null; agencia: string | null; numero: string | null; pix: string | null
  saldo_inicial: number; data_saldo_inicial: string | null; limite: number | null; observacao: string | null; ativa: boolean
}
export interface SaldoConta { id: number; nome: string; tipo: TipoConta; ativa: boolean; saldo_inicial: number; data_saldo_inicial: string | null; limite: number | null; saldo: number }

export type TipoMovimento = 'ENTRADA' | 'SAIDA'
/** Classificação do 1º nível do centro de custo na DRE e no fluxo de caixa (herdada pelos filhos) */
export type GrupoPlano = 'RECEITA_OPERACIONAL' | 'RECEITA_FINANCEIRA' | 'OUTRA_RECEITA' | 'APORTE_EMPRESTIMO'
  | 'DEDUCAO' | 'CUSTO' | 'DESPESA_OPERACIONAL' | 'DESPESA_FINANCEIRA' | 'IMPOSTO_LUCRO' | 'INVESTIMENTO' | 'DISTRIBUICAO_AMORTIZACAO'
export const GRUPOS_PLANO: Record<GrupoPlano, string> = {
  RECEITA_OPERACIONAL: 'Receitas operacionais', RECEITA_FINANCEIRA: 'Receitas financeiras', OUTRA_RECEITA: 'Outras receitas',
  APORTE_EMPRESTIMO: 'Aportes e empréstimos (fora da DRE)', DEDUCAO: 'Deduções da receita', CUSTO: 'Custos',
  DESPESA_OPERACIONAL: 'Despesas operacionais', DESPESA_FINANCEIRA: 'Despesas financeiras', IMPOSTO_LUCRO: 'Impostos sobre o lucro',
  INVESTIMENTO: 'Investimentos (fora da DRE)', DISTRIBUICAO_AMORTIZACAO: 'Distribuição de lucros e amortizações (fora da DRE)',
}
export const GRUPOS_ENTRADA: GrupoPlano[] = ['RECEITA_OPERACIONAL', 'RECEITA_FINANCEIRA', 'OUTRA_RECEITA', 'APORTE_EMPRESTIMO']
export const GRUPOS_SAIDA: GrupoPlano[] = ['DEDUCAO', 'CUSTO', 'DESPESA_OPERACIONAL', 'DESPESA_FINANCEIRA', 'IMPOSTO_LUCRO', 'INVESTIMENTO', 'DISTRIBUICAO_AMORTIZACAO']
/**
 * Centro de custo (0002/0007; tabela interna plano_conta, como categoria_financeira no Luminexus): árvore de até 4 níveis,
 * código de 8 dígitos gerado pelo banco. O tipo (entrada/saída) e o grupo da DRE vêm do 1º nível.
 */
export interface PlanoConta { id: number; tipo: TipoMovimento; grupo: GrupoPlano; nome: string; descricao: string | null; codigo: number; nivel: number; pai_id: number | null; ordem: number; ativa: boolean }

/** Lançamento por modelo (0007, Luminexus 0121): quadro de blocos; cada bloco lista centros de custo (com os filhos) */
export type CorBloco = 'verde' | 'laranja' | 'azul' | 'vermelho' | 'amarelo' | 'roxo' | 'cinza'
export interface BlocoModelo { titulo: string; cor: CorBloco; centros: number[] }
export interface ModeloLancamento { id: number; nome: string; blocos: BlocoModelo[] }

export type TipoParceiro = 'CLIENTE' | 'FORNECEDOR' | 'AMBOS'
export const TIPOS_PARCEIRO: Record<TipoParceiro, string> = { CLIENTE: 'Cliente', FORNECEDOR: 'Fornecedor', AMBOS: 'Cliente e fornecedor' }
export interface Parceiro {
  id: number; tipo: TipoParceiro; pessoa: 'PF' | 'PJ'; nome: string; nome_fantasia: string | null; documento: string | null; inscricao_estadual: string | null
  email: string | null; telefone: string | null; contato: string | null
  cep: string | null; endereco: string | null; numero: string | null; complemento: string | null; bairro: string | null; cidade: string | null; uf: string | null
  banco: string | null; agencia: string | null; conta: string | null; pix: string | null; observacao: string | null; ativo: boolean
}

// ---------- Movimento ----------
export type FormaPagamento = 'DINHEIRO' | 'PIX' | 'TRANSFERENCIA' | 'BOLETO' | 'CARTAO' | 'CHEQUE' | 'DEBITO_AUTOMATICO'
export const FORMAS_PAGAMENTO: Record<FormaPagamento, string> = {
  DINHEIRO: 'Dinheiro', PIX: 'PIX', TRANSFERENCIA: 'Transferência', BOLETO: 'Boleto', CARTAO: 'Cartão', CHEQUE: 'Cheque', DEBITO_AUTOMATICO: 'Débito automático',
}
export type TipoLancamento = 'ENTRADA' | 'SAIDA' | 'TRANSFERENCIA'
export const TIPOS_LANCAMENTO: Record<TipoLancamento, string> = { ENTRADA: 'Entrada', SAIDA: 'Saída', TRANSFERENCIA: 'Transferência entre contas' }
export type OrigemLancamento = 'APP' | 'BAIXA' | 'IMPORTACAO' | 'CARGA'
export interface Lancamento {
  id: number; data: string; competencia: string; tipo: TipoLancamento; plano_conta_id: number | null
  conta_id: number; conta_destino_id: number | null; valor: number; parceiro_id: number | null; forma: FormaPagamento | null
  descricao: string | null; documento: string | null; origem: OrigemLancamento
  /** PENDENTE = veio do extrato e aguarda classificação/conciliação (fora de saldos e relatórios) */
  situacao: 'CONFIRMADO' | 'PENDENTE'
  /** baixa de título (0003): PRINCIPAL abate o título; JUROS e DESCONTO são lançamentos à parte da mesma baixa */
  titulo_id: number | null; titulo_papel: 'PRINCIPAL' | 'JUROS' | 'DESCONTO' | null; baixa_id: string | null
  extrato_id: string | null; extrato_descricao: string | null; importacao_id: number | null
  criado_em?: string; atualizado_em?: string
  // só na view v_lancamento
  plano?: string | null; plano_codigo?: number | null; grupo?: GrupoPlano | null; plano_raiz?: string | null
  conta?: string | null; conta_destino?: string | null; parceiro?: string | null
  titulo_tipo?: TipoTitulo | null; parcela?: number | null; parcelas?: number | null; anexos?: number
}

export type TipoTitulo = 'PAGAR' | 'RECEBER'
export type SituacaoTitulo = 'ABERTO' | 'PARCIAL' | 'PAGO' | 'CANCELADO'
export const SITUACOES_TITULO: Record<SituacaoTitulo, string> = { ABERTO: 'Em aberto', PARCIAL: 'Pago em parte', PAGO: 'Quitado', CANCELADO: 'Cancelado' }
export interface Titulo {
  id: number; tipo: TipoTitulo; parceiro_id: number | null; plano_conta_id: number
  descricao: string; documento: string | null; emissao: string | null; vencimento: string; competencia: string; valor: number
  parcela: number | null; parcelas: number | null; grupo_id: string | null; conta_prevista_id: number | null; forma_prevista: FormaPagamento | null
  codigo_barras: string | null; observacao: string | null; cancelado: boolean; cancelado_motivo: string | null
  /** calculados pelo banco a partir das baixas: nunca enviar */
  valor_pago: number; pago_em: string | null; situacao: SituacaoTitulo
  criado_em?: string; atualizado_em?: string
  // só na view v_titulo
  saldo?: number; vencido?: boolean; dias_atraso?: number; plano?: string | null; plano_codigo?: number | null; plano_raiz?: string | null
  parceiro?: string | null; parceiro_documento?: string | null; conta_prevista?: string | null; anexos?: number
}
/** colunas que a tela grava em titulo (o resto é calculado ou vem da view) */
export const COLUNAS_TITULO = ['tipo', 'parceiro_id', 'plano_conta_id', 'descricao', 'documento', 'emissao', 'vencimento', 'competencia', 'valor',
  'parcela', 'parcelas', 'grupo_id', 'conta_prevista_id', 'forma_prevista', 'codigo_barras', 'observacao', 'cancelado', 'cancelado_motivo'] as const
/** colunas que a tela grava em lancamento */
export const COLUNAS_LANCAMENTO = ['data', 'competencia', 'tipo', 'plano_conta_id', 'conta_id', 'conta_destino_id', 'valor', 'parceiro_id',
  'forma', 'descricao', 'documento', 'situacao'] as const
/** só as colunas gravadas (tira os campos da view e os calculados) */
export function soColunas<T extends object>(o: T, colunas: readonly string[]): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([k]) => colunas.includes(k))) as Partial<T>
}

export interface Anexo { id: number; lancamento_id: number | null; titulo_id: number | null; caminho: string; nome: string; mime: string | null; tamanho: number | null; criado_em: string }

// ---------- Orçamento e fechamento ----------
export interface OrcamentoLinha { ano: number; plano_conta_id: number; plano: string; tipo: TipoMovimento; grupo: GrupoPlano; codigo: number; nivel: number; raiz_codigo: number; raiz: string; mes: number; valor: number; realizado: number }
export interface OrcamentoParametro { ano: number; ano_base: number | null; reajuste_pct: number; fonte_reajuste: string | null; observacao: string | null; gerado_em: string }
export type StatusFechamento = 'FECHADO' | 'APROVADO' | 'RESSALVA' | 'DEVOLVIDO'
export const STATUS_FECHAMENTO: Record<StatusFechamento, string> = { FECHADO: 'Fechado, aguardando parecer', APROVADO: 'Aprovado', RESSALVA: 'Aprovado com ressalvas', DEVOLVIDO: 'Devolvido para correção' }
export interface Balancete {
  mes: string; saldo_inicial: number; entradas: number; saidas: number; saldo_final: number; pendentes: number
  planos: { tipo: TipoMovimento; grupo: GrupoPlano; raiz_codigo: number; raiz: string; plano_conta_id: number; codigo: number; nome: string; total: number; qtd: number }[]
  contas: { id: number; nome: string; tipo: TipoConta; inicial: number; final: number }[]
}
export interface FechamentoMes {
  id: number; mes: string; status: StatusFechamento; saldo_inicial: number; entradas: number; saidas: number; saldo_final: number
  resumo: Balancete; observacao: string | null; fechado_em: string; fechado_por: string | null; parecer: string | null; avaliado_em: string | null; avaliado_por: string | null
}
