// Aceite de tratamento de dados (LGPD) pedido ao fornecedor em todo envio de documento:
// documentos de colaboradores, documentos da empresa e arquivos da medição.
// O texto foi definido pela Emais em 23/10/2026; o servidor guarda a data e hora de cada aceite.

export function TermoLgpd({ marcado, aoMudar, observacao }: { marcado: boolean; aoMudar: (v: boolean) => void; observacao?: string }) {
  return (
    <div className="termo-lgpd">
      <label className="opcao opcao-termo">
        <input type="checkbox" checked={marcado} onChange={(e) => aoMudar(e.target.checked)} />
        <span>
          Declaro que autorizo a Emais Urbanismo a tratar os dados pessoais dos colaboradores da minha empresa, enviados neste sistema, para fins de integração em
          obras, liberação de medição e comprovação de regularidade documental, fiscal e trabalhista, nos termos da LGPD (Lei nº 13.709/2018). Declaro ainda que
          estou autorizado a compartilhar esses dados e que informei os titulares sobre o tratamento.
        </span>
      </label>
      {observacao && <small className="dica">{observacao}</small>}
    </div>
  );
}
