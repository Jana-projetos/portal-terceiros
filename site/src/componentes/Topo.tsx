import { useSessao, nomesPerfil } from '../lib/sessao';

export function Topo() {
  const { usuario, sair } = useSessao();
  return (
    <header className="topo">
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
    </header>
  );
}
