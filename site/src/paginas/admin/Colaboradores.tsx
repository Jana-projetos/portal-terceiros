import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSessao } from '../../lib/sessao';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Dialogo } from '../../componentes/Dialogo';
import { Carregando } from '../../componentes/Carregando';
import { mensagemDeErro } from '../../lib/supabase';
import {
  cpfValido, data, formatarCpf, hojeIso, ordemSituacao, rotuloSituacao, rotuloStatus, soDigitos,
} from '../../lib/formato';
import {
  aprovarAlocacao, devolverAlocacaoTst, lerAlocacoes, lerColaborador, lerDevolucaoTst, lerIdsComPendenciaCadastro, lerPendencias,
  registrarIntegracao, salvarCadastro, validarAlocacao,
  type AlocacaoResumo, type Colaborador, type Pendencia,
} from '../../lib/admin';

type Filtro = 'abertos' | 'fornecedor' | 'analise' | 'tst' | 'liberados' | 'liberados_pendencia' | 'cadastro' | 'encerrados';

const filtros: { id: Filtro; rotulo: string }[] = [
  { id: 'abertos', rotulo: 'Todos ativos' },
  { id: 'analise', rotulo: 'Em análise' },
  { id: 'fornecedor', rotulo: 'Com o fornecedor' },
  { id: 'tst', rotulo: 'Aguardando TST' },
  { id: 'liberados', rotulo: 'Liberados' },
  { id: 'liberados_pendencia', rotulo: 'Liberados com pendência' },
  { id: 'cadastro', rotulo: 'Cadastro a corrigir' },
  { id: 'encerrados', rotulo: 'Desligados' },
];

function passa(a: AlocacaoResumo, f: Filtro, cadastro: Set<string>): boolean {
  switch (f) {
    case 'abertos': return a.status !== 'encerrado';
    case 'fornecedor': return a.status === 'pendente_fornecedor' || a.status === 'em_cadastro';
    case 'analise': return a.status === 'em_analise';
    case 'tst': return a.status === 'aprovado_admin';
    case 'liberados': return a.status === 'liberado';
    case 'liberados_pendencia': return a.status === 'liberado' && a.impeditivos_pendentes > 0;
    case 'cadastro': return cadastro.has(a.colaborador_id);
    case 'encerrados': return a.status === 'encerrado';
  }
}

export function Colaboradores() {
  const { usuario } = useSessao();
  const ehAdmin = usuario?.perfil === 'admin';
  const filtrosDoPerfil = ehAdmin ? filtros : filtros.filter((f) => f.id !== 'cadastro');
  const [params, setParams] = useSearchParams();
  const [alocacoes, setAlocacoes] = useState<AlocacaoResumo[] | null>(null);
  const [cadastro, setCadastro] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);
  const [aberta, setAberta] = useState<AlocacaoResumo | null>(null);

  const obra = params.get('obra') ?? '';
  const filtro = (params.get('situacao') as Filtro) || 'abertos';
  const busca = params.get('busca') ?? '';

  function mudar(chave: string, valor: string) {
    const p = new URLSearchParams(params);
    if (valor) p.set(chave, valor);
    else p.delete(chave);
    setParams(p, { replace: true });
  }

  async function carregar() {
    try {
      const [a, c] = await Promise.all([lerAlocacoes(), ehAdmin ? lerIdsComPendenciaCadastro() : Promise.resolve(new Set<string>())]);
      setAlocacoes(a);
      setCadastro(c);
      return a;
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
      return null;
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  const obras = useMemo(() => {
    const m = new Map<string, string>();
    (alocacoes ?? []).forEach((a) => m.set(a.obra_id, a.obra));
    return [...m.entries()].sort(([, a], [, b]) => a.localeCompare(b, 'pt-BR'));
  }, [alocacoes]);

  const daObra = useMemo(() => (alocacoes ?? []).filter((a) => !obra || a.obra_id === obra), [alocacoes, obra]);

  const contagem = useMemo(() => {
    const c = {} as Record<Filtro, number>;
    filtros.forEach((f) => (c[f.id] = daObra.filter((a) => passa(a, f.id, cadastro)).length));
    return c;
  }, [daObra, cadastro]);

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return daObra
      .filter((a) => passa(a, filtro, cadastro))
      .filter((a) => !t || a.colaborador.toLowerCase().includes(t) || a.empresa.toLowerCase().includes(t))
      .sort((a, b) => a.empresa.localeCompare(b.empresa, 'pt-BR') || a.colaborador.localeCompare(b.colaborador, 'pt-BR'));
  }, [daObra, filtro, busca, cadastro]);

  return (
    <Pagina
      titulo={!ehAdmin && filtro === 'tst' ? 'Para validar' : 'Colaboradores'}
      apoio={ehAdmin
        ? 'Situação de cada colaborador por obra. Clique em um nome para ver as pendências e agir.'
        : 'Colaboradores das suas obras. Os aprovados pela Emais esperam a sua validação para serem liberados.'}
    >
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}

      <div className="filtros">
        <label className="campo">
          <span>Obra</span>
          <select value={obra} onChange={(e) => mudar('obra', e.target.value)}>
            <option value="">Todas as obras</option>
            {obras.map(([id, nome]) => (
              <option key={id} value={id}>{nome}</option>
            ))}
          </select>
        </label>
        <label className="campo campo-busca">
          <span>Buscar</span>
          <input type="search" placeholder="Colaborador ou empresa" value={busca} onChange={(e) => mudar('busca', e.target.value)} />
        </label>
      </div>

      {alocacoes && (
      <div className="chips chips-filtro" role="group" aria-label="Situação">
        {filtrosDoPerfil.map((f) => (
          <button
            key={f.id}
            type="button"
            className="chip"
            aria-pressed={filtro === f.id}
            onClick={() => mudar('situacao', f.id === 'abertos' ? '' : f.id)}
          >
            {f.rotulo} <span className="chip-numero">{contagem[f.id] ?? 0}</span>
          </button>
        ))}
      </div>
      )}

      {!alocacoes && !erro && <Carregando />}
      {alocacoes && (
        <div className="tabela-rolagem">
          <table className="tabela tabela-lista">
            <thead>
              <tr>
                <th scope="col">Colaborador</th>
                <th scope="col">Obra</th>
                <th scope="col">Situação</th>
                <th scope="col">Pendências</th>
                <th scope="col">Integração</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((a) => (
                <tr key={a.alocacao_id} className="linha-clicavel" onClick={() => setAberta(a)}>
                  <th scope="row">
                    <button type="button" className="link-botao" onClick={(e) => { e.stopPropagation(); setAberta(a); }}>
                      {a.colaborador}
                    </button>
                    <small className="sub">{a.empresa}{a.funcao ? `, ${a.funcao.toLowerCase()}` : ''}</small>
                  </th>
                  <td>{a.obra}</td>
                  <td>
                    <span className={`selo selo-${a.status}`}>{rotuloStatus[a.status]}</span>
                    {cadastro.has(a.colaborador_id) && <small className="sub texto-alerta">cadastro a corrigir</small>}
                  </td>
                  <td>
                    {a.status === 'encerrado' ? (
                      <span className="sub">Não se aplica</span>
                    ) : a.impeditivos_pendentes > 0 ? (
                      <>
                        {a.impeditivos_pendentes} {a.impeditivos_pendentes === 1 ? 'impeditivo' : 'impeditivos'}
                        <small className="sub">{[a.pendentes_adm && `${a.pendentes_adm} ADM`, a.pendentes_sst && `${a.pendentes_sst} SST`].filter(Boolean).join(', ')}</small>
                      </>
                    ) : (
                      <span className="sub">Nenhuma impeditiva</span>
                    )}
                    {a.a_vencer > 0 && <small className="sub texto-alerta">{a.a_vencer} vencendo em breve</small>}
                  </td>
                  <td>{a.data_integracao ? data(a.data_integracao) : <span className="sub">Não registrada</span>}</td>
                </tr>
              ))}
              {lista.length === 0 && (
                <tr>
                  <td colSpan={5} className="vazio-linha">Nenhum colaborador nesta seleção.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Detalhe
        ehAdmin={ehAdmin}
        alocacao={aberta}
        aoFechar={() => setAberta(null)}
        aoMudar={async () => {
          const novas = await carregar();
          if (novas && aberta) setAberta(novas.find((x) => x.alocacao_id === aberta.alocacao_id) ?? null);
        }}
      />
    </Pagina>
  );
}

function Detalhe({ ehAdmin, alocacao, aoFechar, aoMudar }: { ehAdmin: boolean; alocacao: AlocacaoResumo | null; aoFechar: () => void; aoMudar: () => Promise<void> }) {
  const [colab, setColab] = useState<Colaborador | null>(null);
  const [pend, setPend] = useState<Pendencia[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [editando, setEditando] = useState(false);
  const [dataInt, setDataInt] = useState(hojeIso());
  const [devolvendo, setDevolvendo] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [devolucaoTst, setDevolucaoTst] = useState<{ motivo: string; em: string } | null>(null);

  const id = alocacao?.alocacao_id;
  const colabId = alocacao?.colaborador_id;

  useEffect(() => {
    setErro(null);
    setOk(null);
    setEditando(false);
    setColab(null);
    setPend(null);
    setDataInt(hojeIso());
    setDevolvendo(false);
    setMotivo('');
    setDevolucaoTst(null);
    if (!id || !colabId) return;
    if (ehAdmin) lerDevolucaoTst(id).then(setDevolucaoTst).catch(() => undefined);
    Promise.all([lerColaborador(colabId), lerPendencias(id)])
      .then(([c, p]) => {
        setColab(c);
        setPend(p.sort((a, b) => ordemSituacao[a.situacao] - ordemSituacao[b.situacao] || Number(b.impeditivo) - Number(a.impeditivo) || a.documento.localeCompare(b.documento, 'pt-BR')));
      })
      .catch((e) => setErro(mensagemDeErro(e)));
  }, [id, colabId, ehAdmin]);

  async function agir(acao: () => Promise<void>, sucesso: string) {
    setErro(null);
    setOk(null);
    setOcupado(true);
    try {
      await acao();
      setOk(sucesso);
      await aoMudar();
      if (colabId) setColab(await lerColaborador(colabId));
      if (id) setPend(await lerPendencias(id));
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setOcupado(false);
    }
  }

  if (!alocacao) return <Dialogo aberto={false} titulo="" aoFechar={aoFechar}>{null}</Dialogo>;

  const travas = (pend ?? []).filter((p) => p.impeditivo && ['nao_enviado', 'em_analise', 'devolvido', 'vencido'].includes(p.situacao));

  return (
    <Dialogo aberto titulo={alocacao.colaborador} aoFechar={aoFechar} largura="larga">
      <div className="detalhe">
        <dl className="ficha">
          <div><dt>Empresa</dt><dd>{alocacao.empresa}</dd></div>
          <div><dt>Obra</dt><dd>{alocacao.obra}</dd></div>
          <div><dt>Função</dt><dd>{colab?.funcoes?.nome ?? colab?.funcao_texto ?? alocacao.funcao ?? 'Não informada'}</dd></div>
          <div><dt>CPF</dt><dd>{colab ? formatarCpf(colab.cpf) || 'Não informado' : ''}</dd></div>
          <div><dt>Situação</dt><dd><span className={`selo selo-${alocacao.status}`}>{rotuloStatus[alocacao.status]}</span></dd></div>
          <div><dt>Integração</dt><dd>{alocacao.data_integracao ? data(alocacao.data_integracao) : 'Não registrada'}</dd></div>
        </dl>

        {ehAdmin && alocacao.status === 'em_analise' && devolucaoTst && (
          <p className="aviso aviso-alerta">
            <strong>Devolvido pelo TST em {data(devolucaoTst.em)}.</strong> {devolucaoTst.motivo}
          </p>
        )}
        {ehAdmin && colab?.pendencia_cadastro && (
          <p className="aviso aviso-alerta">
            <strong>Cadastro a corrigir.</strong> {colab.pendencia_cadastro}
          </p>
        )}
        {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
        {ok && <p className="aviso aviso-ok" role="status">{ok}</p>}

        {!ehAdmin && alocacao.status === 'aprovado_admin' && (
          <div className="caixa">
            <p className="caixa-texto">
              A documentação foi conferida e aprovada pelo administrativo da Emais. Confira os dados abaixo e dê a validação final
              da segurança do trabalho.
            </p>
            {!devolvendo ? (
              <div className="linha-botoes">
                <button
                  type="button"
                  className="botao"
                  disabled={ocupado}
                  onClick={() => agir(() => validarAlocacao(alocacao.alocacao_id), `${alocacao.colaborador} liberado para ${alocacao.obra}.`)}
                >
                  Validar e liberar
                </button>
                <button type="button" className="botao botao-secundario" disabled={ocupado} onClick={() => setDevolvendo(true)}>
                  Devolver ao administrativo
                </button>
              </div>
            ) : (
              <form
                className="formulario formulario-largo"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (motivo.trim()) agir(() => devolverAlocacaoTst(alocacao.alocacao_id, motivo.trim()), 'Devolvido ao administrativo com o motivo informado.');
                }}
              >
                <label className="campo">
                  <span>O que precisa ser revisto</span>
                  <textarea rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: NR-35 sem carga horária mínima; função não confere com a atividade na obra" />
                </label>
                <div className="linha-botoes">
                  <button className="botao" type="submit" disabled={!motivo.trim() || ocupado}>Devolver</button>
                  <button className="botao botao-discreto" type="button" onClick={() => setDevolvendo(false)}>Cancelar</button>
                </div>
              </form>
            )}
          </div>
        )}

        {ehAdmin && (
        <div className="linha-botoes">
          {alocacao.status === 'em_analise' && (
            <button
              type="button"
              className="botao"
              disabled={ocupado || travas.length > 0 || !pend}
              title={travas.length > 0 ? 'Ainda há documento impeditivo pendente' : undefined}
              onClick={() => agir(() => aprovarAlocacao(alocacao.alocacao_id), 'Alocação aprovada. Agora falta a validação do TST da obra.')}
            >
              Aprovar e enviar ao TST
            </button>
          )}
          {alocacao.status === 'liberado' && (
            <form
              className="em-linha"
              onSubmit={(e) => {
                e.preventDefault();
                agir(() => registrarIntegracao(alocacao.alocacao_id, dataInt), `Integração registrada em ${data(dataInt)}.`);
              }}
            >
              <label className="campo campo-compacto">
                <span>Data da integração</span>
                <input type="date" value={dataInt} max={hojeIso()} onChange={(e) => setDataInt(e.target.value)} />
              </label>
              <button className="botao botao-secundario" type="submit" disabled={ocupado || !dataInt}>
                {alocacao.data_integracao ? 'Atualizar integração' : 'Registrar integração'}
              </button>
            </form>
          )}
          {colab && !editando && (
            <button type="button" className="botao botao-discreto" onClick={() => setEditando(true)}>Corrigir cadastro</button>
          )}
        </div>
        )}
        {ehAdmin && alocacao.status === 'em_analise' && travas.length > 0 && (
          <p className="dica">Para aprovar, todos os documentos impeditivos precisam estar aprovados e em dia. Faltam {travas.length}.</p>
        )}

        {ehAdmin && colab && editando && (
          <EdicaoCadastro
            colaborador={colab}
            aoCancelar={() => setEditando(false)}
            aoSalvar={(dados) =>
              agir(async () => {
                await salvarCadastro(colab.id, dados);
                setEditando(false);
              }, 'Cadastro atualizado.')
            }
          />
        )}

        <h3 className="detalhe-subtitulo">Documentos exigidos</h3>
        {!pend && !erro && <Carregando />}
        {pend && pend.length === 0 && <p className="sub">Nenhum documento exigido para este colaborador.</p>}
        {pend && pend.length > 0 && (
          <table className="tabela tabela-lista tabela-compacta">
            <thead>
              <tr>
                <th scope="col">Documento</th>
                <th scope="col">Situação</th>
                <th scope="col">Vence em</th>
              </tr>
            </thead>
            <tbody>
              {pend.map((p) => (
                <tr key={p.tipo_codigo}>
                  <th scope="row">
                    {p.documento}
                    <small className="sub">{p.grupo === 'empresa' ? 'da empresa' : 'do colaborador'}, {p.area}{p.impeditivo ? ', impeditivo' : ''}</small>
                  </th>
                  <td>
                    <span className={`selo selo-doc-${p.situacao}`}>{rotuloSituacao[p.situacao]}</span>
                    {p.situacao === 'devolvido' && p.motivo_devolucao && <small className="sub">{p.motivo_devolucao}</small>}
                    {p.status_envio_aberto === 'em_analise' && p.situacao !== 'em_analise' && <small className="sub">renovação em análise</small>}
                  </td>
                  <td>{p.vencimento ? data(p.vencimento) : <span className="sub">{p.situacao === 'dispensado' ? 'Dispensado' : p.situacao === 'nao_enviado' ? '' : 'Não vence'}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Dialogo>
  );
}

function EdicaoCadastro({
  colaborador, aoCancelar, aoSalvar,
}: {
  colaborador: Colaborador;
  aoCancelar: () => void;
  aoSalvar: (d: { nome: string; cpf: string | null; pendencia_cadastro: string | null }) => void;
}) {
  const [nome, setNome] = useState(colaborador.nome);
  const [cpf, setCpf] = useState(formatarCpf(colaborador.cpf));
  const [conferido, setConferido] = useState(true);

  const digitos = soDigitos(cpf);
  const cpfOk = digitos.length === 0 || cpfValido(digitos);

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (!cpfOk || nome.trim().length < 2) return;
    aoSalvar({
      nome: nome.trim().toUpperCase(),
      cpf: digitos || null,
      pendencia_cadastro: conferido && digitos ? null : colaborador.pendencia_cadastro,
    });
  }

  return (
    <form className="formulario formulario-largo caixa" onSubmit={enviar} noValidate>
      <div className="grade-2">
        <label className="campo">
          <span>Nome</span>
          <input value={nome} onChange={(e) => setNome(e.target.value)} />
        </label>
        <label className="campo">
          <span>CPF</span>
          <input inputMode="numeric" value={cpf} aria-invalid={!cpfOk} onChange={(e) => setCpf(e.target.value)} placeholder="000.000.000-00" />
          {!cpfOk && <small className="campo-erro">CPF inválido. Confira os números.</small>}
        </label>
      </div>
      {colaborador.pendencia_cadastro && (
        <label className="opcao">
          <input type="checkbox" checked={conferido} onChange={(e) => setConferido(e.target.checked)} />
          <span>Cadastro conferido: tirar o aviso de correção</span>
        </label>
      )}
      <div className="linha-botoes">
        <button className="botao" type="submit" disabled={!cpfOk || nome.trim().length < 2}>Salvar cadastro</button>
        <button className="botao botao-discreto" type="button" onClick={aoCancelar}>Cancelar</button>
      </div>
    </form>
  );
}
