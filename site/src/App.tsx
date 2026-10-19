import { useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useSessao } from './lib/sessao';
import { Entrar } from './paginas/Entrar';
import { EsqueciSenha } from './paginas/EsqueciSenha';
import { NovaSenha } from './paginas/NovaSenha';
import { Inicio } from './paginas/Inicio';
import { AcessoBloqueado } from './paginas/AcessoBloqueado';
import { Acessos } from './paginas/admin/Acessos';
import { Analise } from './paginas/admin/Analise';
import { Colaboradores } from './paginas/admin/Colaboradores';
import { Liberacao } from './paginas/admin/Liberacao';
import { Carregando } from './componentes/Carregando';

export function App() {
  const { recuperandoSenha } = useSessao();
  const navegar = useNavigate();

  // Quem chega pelo link de redefinição de senha vai direto para a tela de nova senha.
  useEffect(() => {
    if (recuperandoSenha) navegar('/nova-senha', { replace: true });
  }, [recuperandoSenha, navegar]);

  return (
    <Routes>
      <Route path="/entrar" element={<SoForaDoLogin><Entrar /></SoForaDoLogin>} />
      <Route path="/esqueci-senha" element={<SoForaDoLogin><EsqueciSenha /></SoForaDoLogin>} />
      <Route path="/nova-senha" element={<NovaSenha />} />
      <Route path="/" element={<ComLogin><Inicio /></ComLogin>} />
      <Route path="/analise" element={<SoAdmin><Analise /></SoAdmin>} />
      <Route path="/colaboradores" element={<SoAdmin><Colaboradores /></SoAdmin>} />
      <Route path="/liberacao" element={<SoAdmin><Liberacao /></SoAdmin>} />
      <Route path="/acessos" element={<SoAdmin><Acessos /></SoAdmin>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function ComLogin({ children }: { children: ReactNode }) {
  const { situacao } = useSessao();
  if (situacao === 'carregando') return <Carregando />;
  if (situacao === 'fora') return <Navigate to="/entrar" replace />;
  if (situacao === 'sem_cadastro' || situacao === 'inativo') return <AcessoBloqueado motivo={situacao} />;
  return <>{children}</>;
}

// As telas do administrativo também são protegidas no banco; aqui só evitamos mostrar a tela a quem não é admin.
function SoAdmin({ children }: { children: ReactNode }) {
  const { usuario } = useSessao();
  return (
    <ComLogin>
      {usuario?.perfil === 'admin' ? children : <Navigate to="/" replace />}
    </ComLogin>
  );
}

function SoForaDoLogin({ children }: { children: ReactNode }) {
  const { situacao, recuperandoSenha } = useSessao();
  if (situacao === 'carregando') return <Carregando />;
  if (situacao !== 'fora' && !recuperandoSenha) return <Navigate to="/" replace />;
  return <>{children}</>;
}
