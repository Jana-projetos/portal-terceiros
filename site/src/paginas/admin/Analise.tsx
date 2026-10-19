import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Dialogo } from '../../componentes/Dialogo';
import { Carregando } from '../../componentes/Carregando';
import { mensagemDeErro } from '../../lib/supabase';
import { formatarCnpj } from '../../lib/consultas';
import { data, diasAte, formatarCpf, tamanhoArquivo } from '../../lib/formato';
import {
  abrirArquivo, aprovarDocumento, baixarArquivo, baixarTodos, devolverDocumento, lerFilaAnalise, nomeDoZip, nomePadronizado, vencimentoDoDocumento,
  type DocumentoEmAnalise,
} from '../../lib/admin';

const MOTIVOS_COMUNS = [
  'Arquivo ilegível ou cortado',
  'Documento vencido',
  'Documento de outra pessoa ou empresa',
  'Falta assinatura',
  'Data de emissão não confere com o documento',
];

export function Analise() {
  const [fila, setFila] = useState<DocumentoEmAnalise[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [devolvendo, setDevolvendo] = useState<DocumentoEmAnalise | null>(null);
  const [baixando, setBaixando] = useState<string | null>(null);

  async function carregar() {
    try {
      setFila(await lerFilaAnalise());
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  const grupos = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const lista = (fila ?? []).filter(
      (d) => !t || d.empresas.razao_social.toLowerCase().includes(t) || (d.colaboradores?.nome ?? '').toLowerCase().includes(t),
    );
    const porEmpresa = new Map<string, DocumentoEmAnalise[]>();
    for (const d of lista) {
      const k = d.empresas.razao_social;
      porEmpresa.set(k, [...(porEmpresa.get(k) ?? []), d]);
    }
    return [...porEmpresa.entries()].sort(([a], [b]) => a.localeCompare(b, 'pt-BR'));
  }, [fila, busca]);

  async function executar(id: string, acao: () => Promise<void>, sucesso: string) {
    setErro(null);
    setOcupado(id);
    try {
      await acao();
      setOk(sucesso);
      setFila((f) => (f ?? []).filter((d) => d.id !== id));
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setOcupado(null);
    }
  }

  async function arquivo(acao: () => Promise<void>) {
    setErro(null);
    try {
      await acao();
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    }
  }

  const total = fila?.length ?? 0;
  const contarArquivos = (docs: DocumentoEmAnalise[]) => docs.reduce((n, d) => n + d.arquivos.filter((a) => !a.apagado_em).length, 0);
  const visiveis = grupos.flatMap(([, docs]) => docs);
  const arquivosVisiveis = contarArquivos(visiveis);

  async function baixarLote(chave: string, docs: DocumentoEmAnalise[], rotulo: string) {
    setErro(null);
    setOk(null);
    setBaixando(chave);
    try {
      const qtd = await baixarTodos(docs, nomeDoZip(rotulo), (f, t) => setOk(`Baixando ${f} de ${t} arquivos`));
      setOk(`${qtd} ${qtd === 1 ? 'arquivo baixado' : 'arquivos baixados'} num ZIP, já com o nome padronizado. O prazo de 30 dias para apagar começa a contar agora.`);
      await carregar();
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setBaixando(null);
    }
  }

  return (
    <Pagina
      titulo="Análise de documentos"
      apoio={
        fila
          ? total === 0
            ? 'Nenhum documento esperando análise.'
            : `${total} ${total === 1 ? 'documento enviado espera' : 'documentos enviados esperam'} conferência, do mais antigo para o mais novo.`
          : undefined
      }
    >
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {ok && <Mensagem tipo="ok" aoFechar={() => setOk(null)}>{ok}</Mensagem>}

      {total > 0 && (
        <div className="filtros">
          <label className="campo campo-busca">
            <span>Buscar</span>
            <input type="search" placeholder="Empresa ou colaborador" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </label>
          {arquivosVisiveis > 0 && (
            <div className="filtros-acao">
              <button
                type="button"
                className="botao"
                disabled={!!baixando}
                onClick={() => baixarLote('todos', visiveis, busca.trim() ? busca.trim() : 'fila_de_analise')}
              >
                {baixando === 'todos' ? 'Preparando ZIP' : `Baixar todos (${arquivosVisiveis} ${arquivosVisiveis === 1 ? 'arquivo' : 'arquivos'})`}
              </button>
              <small className="dica">Nome dos arquivos: data de emissão_documento_colaborador</small>
            </div>
          )}
        </div>
      )}

      {!fila && !erro && <Carregando />}
      {fila && total === 0 && (
        <p className="vazio">
          Quando um fornecedor enviar documentos e mandar o colaborador para análise, eles aparecem aqui. Depois de baixar o arquivo
          para o SharePoint, ele fica guardado no portal por mais 30 dias e é apagado.
        </p>
      )}

      {grupos.map(([empresa, docs]) => (
        <section key={empresa} className="bloco">
          <div className="barra-lista">
            <h2 className="bloco-titulo">
              {empresa} <span className="sub">{formatarCnpj(docs[0].empresas.cnpj)}</span>
            </h2>
            {grupos.length > 1 && contarArquivos(docs) > 0 && (
              <button type="button" className="botao botao-secundario botao-pequeno" disabled={!!baixando} onClick={() => baixarLote(empresa, docs, empresa)}>
                {baixando === empresa ? 'Preparando ZIP' : `Baixar desta empresa (${contarArquivos(docs)})`}
              </button>
            )}
          </div>
          <div className="tabela-rolagem">
            <table className="tabela tabela-lista">
              <thead>
                <tr>
                  <th scope="col">Documento</th>
                  <th scope="col">De quem</th>
                  <th scope="col">Emissão</th>
                  <th scope="col">Vence em</th>
                  <th scope="col">Arquivo</th>
                  <th scope="col"><span className="sr">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => {
                  const venc = vencimentoDoDocumento(d);
                  const dias = venc ? diasAte(venc) : null;
                  return (
                    <tr key={d.id}>
                      <th scope="row">
                        {d.tipos_documento.nome}
                        <small className="sub">
                          {d.tipos_documento.area}
                          {d.tipos_documento.impeditivo ? ', impeditivo' : ''}, enviado em {data(d.enviado_em)}
                        </small>
                      </th>
                      <td>
                        {d.colaboradores ? (
                          <>
                            {d.colaboradores.nome}
                            <small className="sub">{formatarCpf(d.colaboradores.cpf) || 'sem CPF'}</small>
                          </>
                        ) : (
                          <span className="sub">Documento da empresa</span>
                        )}
                      </td>
                      <td>{d.dispensado ? <span className="sub">Dispensado</span> : data(d.data_emissao) || <span className="sub">Não informada</span>}</td>
                      <td>
                        {venc ? data(venc) : <span className="sub">Não vence</span>}
                        {dias !== null && dias <= 30 && (
                          <small className={dias <= 0 ? 'sub texto-erro' : 'sub texto-alerta'}>
                            {dias <= 0 ? 'já vencido' : `em ${dias} dias`}
                          </small>
                        )}
                      </td>
                      <td>
                        {d.arquivos.length === 0 && <span className="sub">Sem arquivo</span>}
                        {d.arquivos.map((a) => (
                          <div key={a.id} className="arquivo">
                            {a.apagado_em ? (
                              <span className="sub">{a.nome_original} (apagado)</span>
                            ) : (
                              <>
                                <button type="button" className="link-botao" title={a.nome_original} onClick={() => arquivo(() => abrirArquivo(a.caminho))}>
                                  {nomePadronizado(d, a, d.arquivos.filter((x) => !x.apagado_em).indexOf(a) + 1, d.arquivos.filter((x) => !x.apagado_em).length)}
                                </button>
                                <small className="sub">
                                  {tamanhoArquivo(a.tamanho_bytes)}
                                  {a.baixado_em ? `, baixado em ${data(a.baixado_em)}` : ''}
                                </small>
                                <button
                                  type="button"
                                  className="botao botao-discreto botao-pequeno"
                                  onClick={() => arquivo(async () => {
                                    await baixarArquivo(d, a);
                                    await carregar();
                                  })}
                                >
                                  Baixar
                                </button>
                              </>
                            )}
                          </div>
                        ))}
                      </td>
                      <td className="acoes">
                        <button
                          type="button"
                          className="botao botao-pequeno"
                          disabled={ocupado === d.id}
                          onClick={() => executar(d.id, () => aprovarDocumento(d.id), `${d.tipos_documento.nome} aprovado.`)}
                        >
                          Aprovar
                        </button>
                        <button type="button" className="botao botao-secundario botao-pequeno" disabled={ocupado === d.id} onClick={() => setDevolvendo(d)}>
                          Devolver
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <Devolucao
        documento={devolvendo}
        aoFechar={() => setDevolvendo(null)}
        aoDevolver={async (motivo) => {
          const d = devolvendo!;
          setDevolvendo(null);
          await executar(d.id, () => devolverDocumento(d.id, motivo), `${d.tipos_documento.nome} devolvido ao fornecedor.`);
        }}
      />
    </Pagina>
  );
}

function Devolucao({ documento, aoFechar, aoDevolver }: { documento: DocumentoEmAnalise | null; aoFechar: () => void; aoDevolver: (m: string) => void }) {
  const [motivo, setMotivo] = useState('');
  useEffect(() => setMotivo(''), [documento]);

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (motivo.trim()) aoDevolver(motivo.trim());
  }

  return (
    <Dialogo aberto={!!documento} titulo="Devolver documento" aoFechar={aoFechar}>
      {documento && (
        <form className="formulario formulario-largo" onSubmit={enviar}>
          <p className="apoio">
            {documento.tipos_documento.nome}
            {documento.colaboradores ? ` de ${documento.colaboradores.nome}` : ''}, {documento.empresas.razao_social}. O fornecedor vê o
            motivo nas pendências e o colaborador volta para ele.
          </p>
          <div className="chips" role="group" aria-label="Motivos comuns">
            {MOTIVOS_COMUNS.map((m) => (
              <button key={m} type="button" className="chip" onClick={() => setMotivo(m)}>
                {m}
              </button>
            ))}
          </div>
          <label className="campo">
            <span>Motivo da devolução</span>
            <textarea rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </label>
          <div className="linha-botoes">
            <button className="botao" type="submit" disabled={!motivo.trim()}>Devolver ao fornecedor</button>
            <button className="botao botao-discreto" type="button" onClick={aoFechar}>Cancelar</button>
          </div>
        </form>
      )}
    </Dialogo>
  );
}
