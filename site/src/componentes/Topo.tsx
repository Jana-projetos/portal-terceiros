import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useSessao, nomesPerfil } from '../lib/sessao';
import { contarEmAnalise } from '../lib/admin';

export function Topo() {
  const { usuario, sair } = useSessao();
  const ehAdmin = usuario?.perfil === 'admin';
  const [naFila, setNaFila] = useState<number | null>(null);

  useEffect(() => {
    if (!ehAdmin) return;
    contarEmAnalise().then(setNaFila).catch(() => setNaFila(null));
    const t = window.setInterval(() => contarEmAnalise().then(setNaFila).catch(() => undefined), 60000);
    return () => window.clearInterval(t);
  }, [ehAdmin]);

  return (
    <header className="topo">
      <div className="topo-linha">
        <div className="topo-marca">
          <img src={`${import.meta.env.BASE_URL}icone.svg`} alt="" width={28} height={28} />
          <span>Portal de Terceiros</span>
        </div>
        {usuario && (
          <div className="topo-usuario">
            <span className="topo-nome">
              {usuario.nome}
              <small>{nomesPerfil[usuario.perfil]}</small>
            </span>
            <button className="botao botao-discreto" type="button" onClick={sair}>
              Sair
            </button>
          </div>
        )}
      </div>
      {usuario?.perfil === 'fornecedor' && (
        <nav className="menu" aria-label="Seções do fornecedor">
          <NavLink to="/" end>Obras</NavLink>
          <NavLink to="/pendencias">O que falta</NavLink>
          <NavLink to="/meus-colaboradores">Colaboradores</NavLink>
          <NavLink to="/documentos-empresa">Documentos da empresa</NavLink>
        </nav>
      )}
      {ehAdmin && (
        <nav className="menu" aria-label="Seções do administrativo">
          <NavLink to="/" end>Obras</NavLink>
          <NavLink to="/analise">
            Análise de documentos
            {naFila ? <span className="contador" aria-label={`${naFila} na fila`}>{naFila}</span> : null}
          </NavLink>
          <NavLink to="/colaboradores">Colaboradores</NavLink>
          <NavLink to="/liberacao">Aviso de liberação</NavLink>
          <NavLink to="/acessos">Acessos</NavLink>
        </nav>
      )}
    </header>
  );
}
