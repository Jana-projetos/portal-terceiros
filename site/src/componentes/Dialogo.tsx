import { useEffect, useRef, type ReactNode } from 'react';

type Props = {
  aberto: boolean;
  titulo: string;
  aoFechar: () => void;
  children: ReactNode;
  largura?: 'normal' | 'larga';
};

// Janela sobre a tela, com o <dialog> nativo do navegador (Esc fecha, o foco fica dentro).
export function Dialogo({ aberto, titulo, aoFechar, children, largura = 'normal' }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aberto && !d.open) d.showModal();
    if (!aberto && d.open) d.close();
  }, [aberto]);

  return (
    <dialog
      ref={ref}
      className={`dialogo dialogo-${largura}`}
      onClose={aoFechar}
      onClick={(e) => {
        if (e.target === ref.current) aoFechar();
      }}
      aria-labelledby="dialogo-titulo"
    >
      {aberto && (
        <div className="dialogo-conteudo">
          <header className="dialogo-cabecalho">
            <h2 id="dialogo-titulo">{titulo}</h2>
            <button type="button" className="botao botao-discreto" onClick={aoFechar}>
              Fechar
            </button>
          </header>
          {children}
        </div>
      )}
    </dialog>
  );
}
