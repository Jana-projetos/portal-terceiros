import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Dialogo } from '../../componentes/Dialogo';
import { Carregando } from '../../componentes/Carregando';
import { EnvioDocumento, type PedidoDeEnvio } from '../../componentes/EnvioDocumento';
import { mensagemDeErro } from '../../lib/supabase';
import { cpfValido, data, erroDatasColaborador, formatarCpf, ordemSituacao, rotuloStatus, soDigitos } from '../../lib/formato';
import { alocarEmObra, criarColaborador, enviarParaAnalise, informarDesligamento, lerFuncoes, salvarDatasColaborador, type MeuColaborador, type MinhaEmpresa } from '../../lib/fornecedor';
import { documentosDoColaborador, podeEnviarParaAnalise, travasDaAlocacao, useFornecedor } from '../../lib/useFornecedor';
import { ItemPendencia } from './OQueFalta';

export function MeusColaboradores() {
  const forn = useFornecedor();
  const { dados, erro, setErro, recarregar, alocacoesPorColaborador, pendenciasPorAlocacao } = forn;
  const [params, setParams] = useSearchParams();
  const [busca, setBusca] = useState('');
  const [mostrarDesligados, setMostrarDesligados] = useState(false);
  const [novoAberto, setNovoAberto] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const aberto = params.get('ver');

  function abrir(id: string | null) {
    const p = new URLSearchParams(params);
    if (id) p.set('ver', id);
    else p.delete('ver');
    setParams(p, { replace: true });
  }

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const d = soDigitos(busca);
    return (dados?.colaboradores ?? [])
      .filter((c) => mostrarDesligados || c.situacao === 'ativo')
      .filter((c) => !t || c.nome.toLowerCase().includes(t) || (d.length >= 3 && (c.cpf ?? '').includes(d)));
  }, [dados, busca, mostrarDesligados]);

  const ativos = (dados?.colaboradores ?? []).filter((c) => c.situacao === 'ativo').length;
  const colabAberto = aberto ? dados?.colaboradores.find((c) => c.id === aberto) ?? null : null;

  return (
    <Pagina
      titulo="Colaboradores"
      apoio={dados ? `${ativos} ${ativos === 1 ? 'colaborador ativo' : 'colaboradores ativos'}. Clique no nome para ver os documentos e enviar para análise.` : undefined}
      acoes={dados && dados.empresas.length > 0 ? <button className="botao" type="button" onClick={() => setNovoAberto(true)}>Novo colaborador</button> : undefined}
    >
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {ok && <Mensagem tipo="ok" aoFechar={() => setOk(null)}>{ok}</Mensagem>}
      {!dados && !erro && <Carregando />}

      {dados && (
        <>
          <div className="filtros">
            <label className="campo campo-busca">
              <span>Buscar</span>
              <input type="search" placeholder="Nome ou CPF" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </label>
            <label className="opcao opcao-filtro">
              <input type="checkbox" checked={mostrarDesligados} onChange={(e) => setMostrarDesligados(e.target.checked)} />
              <span>Mostrar desligados</span>
            </label>
          </div>

          {dados.colaboradores.length === 0 ? (
            <p className="vazio">Nenhum colaborador cadastrado ainda. Use "Novo colaborador" para começar.</p>
          ) : (
            <div className="tabela-rolagem">
              <table className="tabela tabela-lista">
                <thead>
                  <tr>
                    <th scope="col">Colaborador</th>
                    <th scope="col">Obras e situação</th>
                    <th scope="col">Falta enviar</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((c) => {
                    const alocs = (alocacoesPorColaborador.get(c.id) ?? []).filter((a) => a.status !== 'encerrado');
                    const faltam = new Set(alocs.flatMap((a) => travasDaAlocacao(pendenciasPorAlocacao.get(a.alocacao_id)).filter((p) => p.grupo === 'colaborador').map((p) => p.tipo_codigo)));
                    return (
                      <tr key={c.id} className="linha-clicavel" onClick={() => abrir(c.id)}>
                        <th scope="row">
                          <button type="button" className="link-botao" onClick={(e) => { e.stopPropagation(); abrir(c.id); }}>{c.nome}</button>
                          <small className="sub">{formatarCpf(c.cpf) || 'CPF não informado'}{c.funcoes?.nome || c.funcao_texto ? `, ${(c.funcoes?.nome ?? c.funcao_texto ?? '').toLowerCase()}` : ''}</small>
                        </th>
                        <td>
                          {c.situacao !== 'ativo' ? (
                            <span className="sub">Desligado</span>
                          ) : alocs.length === 0 ? (
                            <span className="sub">Sem obra</span>
                          ) : (
                            alocs.map((a) => (
                              <div key={a.alocacao_id} className="obra-status">
                                <span>{a.obra}</span> <span className={`selo selo-${a.status}`}>{rotuloStatus[a.status]}</span>
                              </div>
                            ))
                          )}
                        </td>
                        <td>{c.situacao !== 'ativo' ? '' : faltam.size > 0 ? `${faltam.size} ${faltam.size === 1 ? 'documento' : 'documentos'}` : <span className="sub">Nada</span>}</td>
                      </tr>
                    );
                  })}
                  {lista.length === 0 && (
                    <tr><td colSpan={3} className="vazio-linha">Nenhum colaborador encontrado.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          <NovoColaborador
            aberto={novoAberto}
            empresas={dados.empresas}
            aoFechar={() => setNovoAberto(false)}
            aoCriar={async (id, nome) => {
              setNovoAberto(false);
              setOk(`${nome} cadastrado. Agora envie os documentos dele.`);
              await recarregar();
              abrir(id);
            }}
          />
          <DetalheColaborador colaborador={colabAberto} forn={forn} aoFechar={() => abrir(null)} aoMensagem={setOk} />
        </>
      )}
    </Pagina>
  );
}

function NovoColaborador({
  aberto, empresas, aoFechar, aoCriar,
}: {
  aberto: boolean;
  empresas: MinhaEmpresa[];
  aoFechar: () => void;
  aoCriar: (id: string, nome: string) => void;
}) {
  const [empresaId, setEmpresaId] = useState('');
  const [nome, setNome] = useState('');
  const [cpf, setCpf] = useState('');
  const [funcao, setFuncao] = useState('');
  const [admissao, setAdmissao] = useState('');
  const [nascimento, setNascimento] = useState('');
  const [obras, setObras] = useState<string[]>([]);
  const [funcoes, setFuncoes] = useState<{ id: string; nome: string }[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto) return;
    setEmpresaId(empresas.length === 1 ? empresas[0].id : '');
    setNome('');
    setCpf('');
    setFuncao('');
    setAdmissao('');
    setNascimento('');
    setObras([]);
    setErro(null);
    if (funcoes.length === 0) lerFuncoes().then(setFuncoes).catch(() => undefined);
  }, [aberto]); // eslint-disable-line react-hooks/exhaustive-deps

  const empresa = empresas.find((e) => e.id === empresaId);
  const digitos = soDigitos(cpf);
  const cpfOk = cpfValido(digitos);
  const funcaoCadastrada = funcoes.find((f) => f.nome.toLowerCase() === funcao.trim().toLowerCase());
  const erroDatas = erroDatasColaborador(admissao, nascimento);
  const valido = !!empresa && nome.trim().split(/\s+/).length >= 2 && cpfOk && funcao.trim().length >= 3 && !!admissao && !!nascimento && !erroDatas;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!valido || !empresa) return;
    setErro(null);
    setEnviando(true);
    try {
      const nomeFinal = nome.trim().replace(/\s+/g, ' ').toUpperCase();
      const id = await criarColaborador({
        empresa_id: empresa.id,
        nome: nomeFinal,
        cpf: digitos,
        funcao_id: funcaoCadastrada?.id ?? null,
        funcao_texto: funcao.trim().toUpperCase(),
        data_admissao: admissao,
        data_nascimento: nascimento,
        obras,
      });
      aoCriar(id, nomeFinal);
    } catch (er) {
      setErro(mensagemDeErro(er as Error));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialogo aberto={aberto} titulo="Novo colaborador" aoFechar={aoFechar} largura="larga">
      <form className="formulario formulario-largo" onSubmit={enviar} noValidate>
        {empresas.length > 1 && (
          <label className="campo">
            <span>Empresa</span>
            <select value={empresaId} onChange={(e) => { setEmpresaId(e.target.value); setObras([]); }}>
              <option value="">Escolha a empresa</option>
              {empresas.map((e) => <option key={e.id} value={e.id}>{e.razao_social}</option>)}
            </select>
          </label>
        )}
        <div className="grade-2">
          <label className="campo">
            <span>Nome completo</span>
            <input value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="off" />
          </label>
          <label className="campo">
            <span>CPF</span>
            <input inputMode="numeric" placeholder="000.000.000-00" value={cpf} aria-invalid={digitos.length === 11 && !cpfOk} onChange={(e) => setCpf(e.target.value)} />
            {digitos.length === 11 && !cpfOk && <small className="campo-erro">CPF inválido. Confira os números.</small>}
          </label>
        </div>
        <label className="campo">
          <span>Função</span>
          <input list="lista-funcoes" value={funcao} onChange={(e) => setFuncao(e.target.value)} placeholder="Ex.: PEDREIRO" autoComplete="off" />
          <datalist id="lista-funcoes">
            {funcoes.map((f) => <option key={f.id} value={f.nome} />)}
          </datalist>
          <small className="dica">
            {funcao.trim().length >= 3 && !funcaoCadastrada
              ? 'Função nova: a Emais confere quais treinamentos (NRs) ela exige.'
              : 'Escolha da lista. A função define quais NRs são obrigatórias.'}
          </small>
        </label>
        <div className="grade-2">
          <label className="campo">
            <span>Data de admissão (registro)</span>
            <input type="date" value={admissao} onChange={(e) => setAdmissao(e.target.value)} />
          </label>
          <label className="campo">
            <span>Data de nascimento</span>
            <input type="date" value={nascimento} onChange={(e) => setNascimento(e.target.value)} />
          </label>
        </div>
        {erroDatas && <small className="campo-erro">{erroDatas}</small>}
        {empresa && (
          <div className="campo">
            <span>Obras onde vai trabalhar</span>
            {empresa.obras.length === 0 ? (
              <small className="dica">Sua empresa ainda não está cadastrada em nenhuma obra. Fale com a Emais.</small>
            ) : (
              <ul className="lista-marcar lista-curta">
                {empresa.obras.map((o) => (
                  <li key={o.id}>
                    <label>
                      <input type="checkbox" checked={obras.includes(o.id)} onChange={() => setObras((l) => (l.includes(o.id) ? l.filter((x) => x !== o.id) : [...l, o.id]))} />
                      <span>{o.nome}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
        <div className="linha-botoes">
          <button className="botao" type="submit" disabled={!valido || enviando}>{enviando ? 'Cadastrando' : 'Cadastrar colaborador'}</button>
          <button className="botao botao-discreto" type="button" onClick={aoFechar}>Cancelar</button>
        </div>
      </form>
    </Dialogo>
  );
}

function DetalheColaborador({
  colaborador, forn, aoFechar, aoMensagem,
}: {
  colaborador: MeuColaborador | null;
  forn: ReturnType<typeof useFornecedor>;
  aoFechar: () => void;
  aoMensagem: (m: string) => void;
}) {
  const { dados, recarregar, empresaPorId, alocacoesPorColaborador, pendenciasPorAlocacao } = forn;
  const [pedido, setPedido] = useState<PedidoDeEnvio | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [novaObra, setNovaObra] = useState('');
  const [confirmarDesligamento, setConfirmarDesligamento] = useState(false);

  useEffect(() => {
    setErro(null);
    setNovaObra('');
    setConfirmarDesligamento(false);
  }, [colaborador?.id]);

  if (!colaborador || !dados) return <Dialogo aberto={false} titulo="" aoFechar={aoFechar}>{null}</Dialogo>;
  const empresa = empresaPorId.get(colaborador.empresa_id);
  const alocs = (alocacoesPorColaborador.get(colaborador.id) ?? []).filter((a) => a.status !== 'encerrado');
  const docs = documentosDoColaborador(colaborador.id, dados.pendencias).sort(
    (a, b) => ordemSituacao[a.situacao] - ordemSituacao[b.situacao] || Number(b.impeditivo) - Number(a.impeditivo) || a.documento.localeCompare(b.documento, 'pt-BR'),
  );
  const obrasLivres = (empresa?.obras ?? []).filter((o) => !alocs.some((a) => a.obra_id === o.id));
  const ativo = colaborador.situacao === 'ativo';

  async function agir(chave: string, acao: () => Promise<void>, sucesso: string) {
    setErro(null);
    setOcupado(chave);
    try {
      await acao();
      aoMensagem(sucesso);
      await recarregar();
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setOcupado(null);
    }
  }

  return (
    <>
      <Dialogo aberto={!pedido} titulo={colaborador.nome} aoFechar={aoFechar} largura="larga">
        <div className="detalhe">
          <dl className="ficha">
            <div><dt>Empresa</dt><dd>{empresa?.razao_social}</dd></div>
            <div><dt>CPF</dt><dd>{formatarCpf(colaborador.cpf) || 'Não informado'}</dd></div>
            <div><dt>Função</dt><dd>{colaborador.funcoes?.nome ?? colaborador.funcao_texto ?? 'Não informada'}</dd></div>
            <div><dt>Admissão</dt><dd>{data(colaborador.data_admissao) || 'Não informada'}</dd></div>
            <div><dt>Nascimento</dt><dd>{data(colaborador.data_nascimento) || 'Não informada'}</dd></div>
          </dl>
          {ativo && (
            <DatasDoCadastro
              key={colaborador.id}
              colaborador={colaborador}
              aoSalvar={(adm, nasc) => agir('datas', () => salvarDatasColaborador(colaborador.id, adm, nasc), 'Datas do cadastro atualizadas.')}
            />
          )}
          {!ativo && <p className="aviso aviso-alerta">Colaborador desligado. As alocações nas obras foram encerradas.</p>}
          {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}

          {ativo && (
            <>
              <h3 className="detalhe-subtitulo">Obras</h3>
              {alocs.length === 0 && <p className="sub">Ainda não está em nenhuma obra.</p>}
              <ul className="lista-simples">
                {alocs.map((a) => {
                  const travas = travasDaAlocacao(pendenciasPorAlocacao.get(a.alocacao_id));
                  return (
                    <li key={a.alocacao_id}>
                      <span>
                        <strong>{a.obra}</strong> <span className={`selo selo-${a.status}`}>{rotuloStatus[a.status]}</span>
                        {podeEnviarParaAnalise(a) && travas.length > 0 && (
                          <small className="sub">Para enviar à análise, falta: {travas.map((t) => t.documento).join(', ')}</small>
                        )}
                        {a.status === 'em_analise' && <small className="sub">A Emais está conferindo os documentos.</small>}
                        {a.status === 'aprovado_admin' && <small className="sub">Aprovado pela Emais, aguardando a segurança do trabalho da obra.</small>}
                      </span>
                      {podeEnviarParaAnalise(a) && (
                        <button
                          type="button"
                          className="botao botao-pequeno"
                          disabled={travas.length > 0 || !!ocupado}
                          onClick={() => agir(a.alocacao_id, () => enviarParaAnalise(a.alocacao_id), `${colaborador.nome} enviado para análise em ${a.obra}.`)}
                        >
                          {ocupado === a.alocacao_id ? 'Enviando' : 'Enviar para análise'}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              {obrasLivres.length > 0 && (
                <form
                  className="em-linha"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (novaObra) agir('obra', () => alocarEmObra(colaborador.id, novaObra), 'Colaborador incluído na obra.');
                  }}
                >
                  <label className="campo campo-compacto">
                    <span>Incluir em outra obra</span>
                    <select value={novaObra} onChange={(e) => setNovaObra(e.target.value)}>
                      <option value="">Escolha a obra</option>
                      {obrasLivres.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
                    </select>
                  </label>
                  <button className="botao botao-secundario" type="submit" disabled={!novaObra || !!ocupado}>Incluir</button>
                </form>
              )}

              <h3 className="detalhe-subtitulo">Documentos do colaborador</h3>
              {docs.length === 0 ? (
                <p className="sub">Os documentos exigidos aparecem quando o colaborador estiver em uma obra.</p>
              ) : (
                <ul className="lista-pendencias">
                  {docs.map((p) => (
                    <li key={p.tipo_codigo}>
                      <ItemPendencia
                        nome={p.documento}
                        situacao={p.situacao}
                        impeditivo={p.impeditivo}
                        vencimento={p.vencimento}
                        motivo={p.situacao === 'devolvido' ? p.motivo_devolucao : null}
                        renovacaoEmAnalise={p.status_envio_aberto === 'em_analise'}
                        aoEnviar={() => {
                          const tipo = dados.tipos.get(p.tipo_codigo);
                          if (tipo && empresa) {
                            setPedido({ tipo, empresaId: empresa.id, empresaNome: empresa.razao_social, colaborador: { id: colaborador.id, nome: colaborador.nome }, motivoDevolucao: p.situacao === 'devolvido' ? p.motivo_devolucao : null });
                          }
                        }}
                      />
                    </li>
                  ))}
                </ul>
              )}
              <p className="dica">Os documentos da empresa (cartão CNPJ, PGR, PCMSO e outros) ficam em Documentos da empresa.</p>

              <div className="zona-final">
                {!confirmarDesligamento ? (
                  <button type="button" className="botao botao-discreto" onClick={() => setConfirmarDesligamento(true)}>Informar desligamento</button>
                ) : (
                  <div className="caixa">
                    <p>Confirma que {colaborador.nome} saiu da empresa? Ele deixa de aparecer nas obras.</p>
                    <div className="linha-botoes">
                      <button type="button" className="botao" disabled={!!ocupado} onClick={() => agir('deslig', () => informarDesligamento(colaborador.id, 'demitido'), `Desligamento de ${colaborador.nome} registrado.`)}>
                        Confirmar desligamento
                      </button>
                      <button type="button" className="botao botao-discreto" onClick={() => setConfirmarDesligamento(false)}>Cancelar</button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </Dialogo>
      <EnvioDocumento
        pedido={pedido}
        aoFechar={() => setPedido(null)}
        aoEnviar={async (nome) => {
          setPedido(null);
          aoMensagem(`${nome} enviado. A Emais confere e você acompanha por aqui.`);
          await recarregar();
        }}
      />
    </>
  );
}

// Admissão e nascimento: o fornecedor completa quando falta e corrige quando está errado.
function DatasDoCadastro({ colaborador, aoSalvar }: { colaborador: MeuColaborador; aoSalvar: (adm: string, nasc: string) => void }) {
  const faltam = !colaborador.data_admissao || !colaborador.data_nascimento;
  const [aberto, setAberto] = useState(false);
  const [admissao, setAdmissao] = useState(colaborador.data_admissao ?? '');
  const [nascimento, setNascimento] = useState(colaborador.data_nascimento ?? '');
  const erro = erroDatasColaborador(admissao, nascimento);

  if (!aberto) {
    return faltam ? (
      <p className="aviso aviso-alerta aviso-faixa">
        <span>Complete o cadastro: falta a data de {!colaborador.data_admissao && !colaborador.data_nascimento ? 'admissão e de nascimento' : !colaborador.data_admissao ? 'admissão' : 'nascimento'}.</span>
        <button type="button" className="botao botao-pequeno" onClick={() => setAberto(true)}>Informar datas</button>
      </p>
    ) : (
      <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => setAberto(true)}>Corrigir datas</button>
    );
  }
  return (
    <form
      className="formulario formulario-largo caixa"
      onSubmit={(e) => {
        e.preventDefault();
        if (admissao && nascimento && !erro) {
          aoSalvar(admissao, nascimento);
          setAberto(false);
        }
      }}
      noValidate
    >
      <div className="grade-2">
        <label className="campo">
          <span>Data de admissão (registro)</span>
          <input type="date" value={admissao} onChange={(e) => setAdmissao(e.target.value)} />
        </label>
        <label className="campo">
          <span>Data de nascimento</span>
          <input type="date" value={nascimento} onChange={(e) => setNascimento(e.target.value)} />
        </label>
      </div>
      {erro && <small className="campo-erro">{erro}</small>}
      <div className="linha-botoes">
        <button className="botao" type="submit" disabled={!admissao || !nascimento || !!erro}>Salvar datas</button>
        <button className="botao botao-discreto" type="button" onClick={() => setAberto(false)}>Cancelar</button>
      </div>
    </form>
  );
}
