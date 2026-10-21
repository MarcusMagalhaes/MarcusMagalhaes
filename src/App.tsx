import { lazy, Suspense } from 'react'
import type React from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/lib/auth'
import { ToastProvider, Carregando, Ocupado, TelaComErro, Visualizador } from '@/components/ui'
import Layout from '@/components/Layout'
import Login, { JanelaLogin } from '@/pages/Login'
import EscolherEmpresa from '@/pages/EscolherEmpresa'
import { ehAdmin, ehLeitor, ehOperador } from '@/lib/types'
import { ehJanelaLogin } from '@/lib/pwa'

// telas carregadas sob demanda (cada uma num arquivo; o pacote inicial fica só com login e escolha de empresa).
// O que outra tela usa de uma página (tipos, funções) vai para src/lib/, senão a página inteira volta ao pacote inicial.
const Painel = lazy(() => import('@/pages/Painel'))
const Lancamentos = lazy(() => import('@/pages/financeiro/Lancamentos'))
const Titulos = lazy(() => import('@/pages/financeiro/Titulos'))
const Conciliacao = lazy(() => import('@/pages/financeiro/Conciliacao'))
const Fechamento = lazy(() => import('@/pages/financeiro/Fechamento'))
const Orcamento = lazy(() => import('@/pages/financeiro/Orcamento'))
const FluxoCaixa = lazy(() => import('@/pages/relatorios/FluxoCaixa'))
const Dre = lazy(() => import('@/pages/relatorios/Dre'))
const RelatorioMensal = lazy(() => import('@/pages/relatorios/RelatorioMensal'))
const ExtratoConta = lazy(() => import('@/pages/relatorios/ExtratoConta'))
const Parceiros = lazy(() => import('@/pages/cadastros/Parceiros'))
const Contas = lazy(() => import('@/pages/cadastros/Contas'))
const PlanoContas = lazy(() => import('@/pages/cadastros/PlanoContas'))
const CentrosCusto = lazy(() => import('@/pages/cadastros/CentrosCusto'))
const Usuarios = lazy(() => import('@/pages/admin/Usuarios'))
const EmpresaPagina = lazy(() => import('@/pages/admin/Empresa'))
const Auditoria = lazy(() => import('@/pages/admin/Auditoria'))

const INICIO = '/painel'

/** op: quem opera o financeiro (todos menos o contador) · admin: diretoria, administrador e TI. Sem marca: todos os papéis */
function Protegido({ op, admin, children }: { op?: boolean; admin?: boolean; children: React.ReactElement }) {
  const { usuario, empresa, perfil } = useAuth()
  if (!usuario) return <Navigate to="/login" replace />
  if (!empresa) return <EscolherEmpresa />
  if (!ehLeitor(perfil)) return <Navigate to="/login" replace />
  if (op && !ehOperador(perfil)) return <Navigate to={INICIO} replace />
  if (admin && !ehAdmin(perfil)) return <Navigate to={INICIO} replace />
  return children
}

function Rotas() {
  const { usuario, carregando, session, empresa } = useAuth()
  const { pathname } = useLocation()
  // janela aberta pelo app instalado no iPhone só para o login (Luminexus 1.1.025): conclui, avisa e se fecha
  if (ehJanelaLogin()) return <JanelaLogin />
  if (carregando) return <Carregando texto="Iniciando…" />
  if (!usuario && session) return <Login />
  if (usuario && !empresa) return <EscolherEmpresa />
  return (
    <TelaComErro chave={pathname}>
    <Suspense fallback={<Carregando />}>
    <Routes>
      <Route path="/login" element={usuario ? <Navigate to={INICIO} replace /> : <Login />} />
      <Route element={<Protegido><Layout /></Protegido>}>
        <Route index element={<Navigate to={INICIO} replace />} />
        <Route path="/painel" element={<Painel />} />
        <Route path="/financeiro/lancamentos" element={<Lancamentos />} />
        <Route path="/financeiro/pagar" element={<Titulos key="PAGAR" tipo="PAGAR" />} />
        <Route path="/financeiro/receber" element={<Titulos key="RECEBER" tipo="RECEBER" />} />
        <Route path="/financeiro/conciliacao" element={<Protegido op><Conciliacao /></Protegido>} />
        <Route path="/financeiro/fechamento" element={<Fechamento />} />
        <Route path="/financeiro/orcamento" element={<Orcamento />} />
        <Route path="/relatorios/fluxo-caixa" element={<FluxoCaixa />} />
        <Route path="/relatorios/dre" element={<Dre />} />
        <Route path="/relatorios/mensal" element={<RelatorioMensal />} />
        <Route path="/relatorios/extrato" element={<ExtratoConta />} />
        <Route path="/cadastros/parceiros" element={<Parceiros />} />
        <Route path="/cadastros/contas" element={<Contas />} />
        <Route path="/cadastros/plano-contas" element={<PlanoContas />} />
        <Route path="/cadastros/centros-custo" element={<CentrosCusto />} />
        <Route path="/admin/usuarios" element={<Protegido admin><Usuarios /></Protegido>} />
        <Route path="/admin/empresa" element={<Protegido admin><EmpresaPagina /></Protegido>} />
        <Route path="/admin/auditoria" element={<Protegido admin><Auditoria /></Protegido>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
    </TelaComErro>
  )
}

export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <ToastProvider>
          <Rotas />
          {/* fora das rotas e com proteção própria: um erro ao mostrar um arquivo não derruba o app inteiro */}
          <TelaComErro chave="visualizador"><Visualizador /></TelaComErro>
          <Ocupado />
        </ToastProvider>
      </AuthProvider>
    </HashRouter>
  )
}
