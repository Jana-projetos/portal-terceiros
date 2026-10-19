import type { ReactNode } from 'react';

// Moldura das telas sem login: painel da marca à esquerda (no celular, em cima) e o formulário ao lado.
export function Moldura({ children }: { children: ReactNode }) {
  return (
    <div className="moldura">
      <aside className="moldura-marca">
        <div className="marca-topo">
          <img src={`${import.meta.env.BASE_URL}icone.svg`} alt="" width={36} height={36} />
          <span>Grupo Emais</span>
        </div>
        <div className="marca-texto">
          <h1>Portal de Terceiros</h1>
          <p>Cadastro de colaboradores, documentos e liberação para as obras.</p>
        </div>
        <div className="faixa-obra" aria-hidden="true" />
      </aside>
      <main className="moldura-conteudo">{children}</main>
    </div>
  );
}
