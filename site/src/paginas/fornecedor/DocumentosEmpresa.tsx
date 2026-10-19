import { useEffect, useState } from 'react';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Carregando } from '../../componentes/Carregando';
import { EnvioDocumento, type PedidoDeEnvio } from '../../componentes/EnvioDocumento';
import { mensagemDeErro } from '../../lib/supabase';
import { formatarCnpj } from '../../lib/consultas';
import { ordemSituacao } from '../../lib/formato';
import { lerDocumentosDaEmpresa, type DocumentoEmpresa } from '../../lib/fornecedor';
import { useFornecedor } from '../../lib/useFornecedor';
import { ItemPendencia } from './OQueFalta';

export function DocumentosEmpresa() {
  const { dados, erro, setErro, recarregar } = useFornecedor();
  const [docs, setDocs] = useState<Map<string, DocumentoEmpresa[]> | null>(null);
  const [pedido, setPedido] = useState<PedidoDeEnvio | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    if (!dados) return;
    Promise.all(dados.empresas.map(async (e) => [e.id, await lerDocumentosDaEmpresa(e, dados.tipos)] as const))
      .then((pares) => setDocs(new Map(pares)))
      .catch((e) => setErro(mensagemDeErro(e)));
  }, [dados, setErro]);

  return (
    <Pagina titulo="Documentos da empresa" apoio="Valem para todos os colaboradores da empresa. Mantenha em dia para não travar as liberações.">
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {ok && <Mensagem tipo="ok" aoFechar={() => setOk(null)}>{ok}</Mensagem>}
      {(!dados || !docs) && !erro && <Carregando />}

      {dados && docs && dados.empresas.map((empresa) => (
        <section key={empresa.id} className="bloco">
          <h2 className="bloco-titulo">
            {empresa.razao_social} <span className="sub">{formatarCnpj(empresa.cnpj)}</span>
          </h2>
          <ul className="lista-pendencias">
            {(docs.get(empresa.id) ?? [])
              .slice()
              .sort((a, b) => ordemSituacao[a.situacao] - ordemSituacao[b.situacao] || a.tipo.ordem - b.tipo.ordem)
              .map((d) => (
                <li key={d.tipo.codigo}>
                  <ItemPendencia
                    nome={d.tipo.nome}
                    situacao={d.situacao}
                    impeditivo={d.tipo.impeditivo}
                    vencimento={d.vencimento}
                    motivo={d.motivo_devolucao}
                    renovacaoEmAnalise={d.renovacaoEmAnalise}
                    aoEnviar={() => setPedido({ tipo: d.tipo, empresaId: empresa.id, empresaNome: empresa.razao_social, colaborador: null, motivoDevolucao: d.motivo_devolucao })}
                  />
                </li>
              ))}
          </ul>
        </section>
      ))}

      <EnvioDocumento
        pedido={pedido}
        aoFechar={() => setPedido(null)}
        aoEnviar={async (nome) => {
          setPedido(null);
          setOk(`${nome} enviado. A Emais confere e você acompanha por aqui.`);
          setDocs(null);
          await recarregar();
        }}
      />
    </Pagina>
  );
}
