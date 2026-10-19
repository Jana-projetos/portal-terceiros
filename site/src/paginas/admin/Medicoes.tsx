import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Dialogo } from '../../componentes/Dialogo';
import { Carregando } from '../../componentes/Carregando';
import { mensagemDeErro, enderecoDoSite } from '../../lib/supabase';
import { useSessao } from '../../lib/sessao';
import { formatarCnpj } from '../../lib/consultas';
import { data, tamanhoArquivo } from '../../lib/formato';
import { copiarTexto, lerAlocacoes, linkOutlook, type AlocacaoResumo } from '../../lib/admin';
import {
  CHAVES_CONFERENCIA, abrirArquivoMedicao, arquivosAtuais, avaliarItem, baixarArquivoMedicao, baixarMedicao, competenciaPadrao,
  concluirConferencia, conferirColaborador, lerMedicao, lerMedicoes, lerTiposMedicao, mesCurto, mesPorExtenso, nomeArquivoMedicao,
  registrarCobranca, rotuloConferencia, rotuloSituacaoColaborador, rotuloStatusItem, rotuloStatusMedicao, seloItem, seloMedicao,
  type ChaveConferencia, type DetalheMedicao, type ItemMedicao, type LinhaColaborador, type Marcacao, type Medicao,
  type SituacaoColaborador, type TipoMedicao,
} from '../../lib/medicao';

const CHAVE_DESTINO = 'portal-terceiros:retencao:';

function lerDestino(obraId: string): string {
  try {
    return window.localStorage.getItem(CHAVE_DESTINO + obraId) ?? '';
  } catch {
    return '';
  }
}

function guardarDestino(obraId: string, valor: string) {
  try {
    window.localStorage.setItem(CHAVE_DESTINO + obraId, valor);
  } catch {
    // sem armazenamento no navegador: segue sem lembrar
  }
}

// Meses com medição: de março de 2026 (início do controle) até o mês atual.
function mesesDoPainel(): string[] {
  const lista: string[] = [];
  const hoje = new Date();
  for (let d = new Date(hoje.getFullYear(), hoje.getMonth(), 1); d >= new Date(2026, 2, 1); d.setMonth(d.getMonth() - 1)) {
    lista.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
  }
  return lista;
}

export function Medicoes() {
  const [params, setParams] = useSearchParams();
  const id = params.get('m');
  const competencia = params.get('mes') ?? competenciaPadrao();
  return id ? (
    <DetalheAdmin id={id} aoVoltar={() => setParams({ mes: competencia })} />
  ) : (
    <Painel competencia={competencia} aoMudarMes={(mes) => setParams({ mes })} />
  );
}

// ---------------------------------------------------------------- Painel do mês

type Filtro = 'todas' | 'em_analise' | 'pendente' | 'retidas' | 'aprovadas' | 'nao_iniciadas';

type NaoIniciada = { empresa_id: string; empresa: string; obra_id: string; obra: string; liberados: number };

function Painel({ competencia, aoMudarMes }: { competencia: string; aoMudarMes: (mes: string) => void }) {
  const { usuario } = useSessao();
  const [medicoes, setMedicoes] = useState<Medicao[] | null>(null);
  const [alocacoes, setAlocacoes] = useState<AlocacaoResumo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [busca, setBusca] = useState('');
  const [selecao, setSelecao] = useState<Set<string>>(new Set());
  const [retencao, setRetencao] = useState(false);

  useEffect(() => {
    setMedicoes(null);
    setSelecao(new Set());
    lerMedicoes({ competencia })
      .then(setMedicoes)
      .catch((e) => setErro(mensagemDeErro(e)));
  }, [competencia]);

  useEffect(() => {
    lerAlocacoes()
      .then(setAlocacoes)
      .catch((e) => setErro(mensagemDeErro(e)));
  }, []);

  // Empresa com colaborador liberado na obra e sem medição no mês (nem no controle anterior, sem obra).
  const naoIniciadas = useMemo<NaoIniciada[]>(() => {
    if (!medicoes || !alocacoes) return [];
    const comMedicao = new Set(medicoes.map((m) => `${m.empresa_id}|${m.obra_id ?? ''}`));
    const semObra = new Set(medicoes.filter((m) => !m.obra_id).map((m) => m.empresa_id));
    const pares = new Map<string, NaoIniciada>();
    for (const a of alocacoes) {
      if (a.status !== 'liberado') continue;
      const chave = `${a.empresa_id}|${a.obra_id}`;
      if (comMedicao.has(chave) || semObra.has(a.empresa_id)) continue;
      const p = pares.get(chave) ?? { empresa_id: a.empresa_id, empresa: a.empresa, obra_id: a.obra_id, obra: a.obra, liberados: 0 };
      p.liberados += 1;
      pares.set(chave, p);
    }
    return [...pares.values()].sort((x, y) => x.empresa.localeCompare(y.empresa, 'pt-BR'));
  }, [medicoes, alocacoes]);

  const contagem = useMemo(() => {
    const l = medicoes ?? [];
    return {
      todas: l.length,
      em_analise: l.filter((m) => m.status === 'em_analise').length,
      pendente: l.filter((m) => m.status === 'pendente_fornecedor' || m.status === 'aberta').length,
      retidas: l.filter((m) => m.retida).length,
      aprovadas: l.filter((m) => m.status === 'aprovada').length,
      nao_iniciadas: naoIniciadas.length,
      no_prazo: l.filter((m) => m.entregue_no_prazo).length,
    };
  }, [medicoes, naoIniciadas]);

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return (medicoes ?? [])
      .filter((m) => {
        if (filtro === 'em_analise') return m.status === 'em_analise';
        if (filtro === 'pendente') return m.status === 'pendente_fornecedor' || m.status === 'aberta';
        if (filtro === 'retidas') return m.retida;
        if (filtro === 'aprovadas') return m.status === 'aprovada';
        return filtro === 'todas';
      })
      .filter((m) => !t || m.empresa.toLowerCase().includes(t) || (m.obra ?? '').toLowerCase().includes(t))
      .sort((a, b) => ordemPainel(a) - ordemPainel(b) || a.empresa.localeCompare(b.empresa, 'pt-BR'));
  }, [medicoes, filtro, busca]);

  const naoIniciadasVisiveis = naoIniciadas.filter((n) => {
    const t = busca.trim().toLowerCase();
    return !t || n.empresa.toLowerCase().includes(t) || n.obra.toLowerCase().includes(t);
  });

  const cobraveis = visiveis.filter((m) => m.status !== 'aprovada' && m.status !== 'em_analise');
  const selecionadas = (medicoes ?? []).filter((m) => selecao.has(m.id));

  function alternar(idM: string) {
    setSelecao((s) => {
      const n = new Set(s);
      if (n.has(idM)) n.delete(idM);
      else n.add(idM);
      return n;
    });
  }

  async function cobrar(lista: Medicao[]) {
    setErro(null);
    const emails = [...new Set(lista.flatMap((m) => (m.email_cobranca ?? '').split(/[;,\s]+/).filter((e) => e.includes('@'))))];
    if (emails.length === 0) {
      setErro('As empresas selecionadas não têm e-mail de cobrança cadastrado.');
      return;
    }
    const mes = mesPorExtenso(competencia);
    const prazo = data(lista[0].prazo);
    const assunto = `Medição de ${mes}: documentos pendentes`;
    const corpo = [
      'Olá,',
      '',
      `A medição de ${mes} da sua empresa ainda não foi aprovada pela Emais: falta enviar documentos ou corrigir o que foi devolvido.`,
      '',
      `O prazo de entrega é ${prazo}. Sem a medição aprovada, o pagamento fica retido.`,
      '',
      `Para ver exatamente o que falta e enviar, entre no Portal de Terceiros, em Medição: ${enderecoDoSite}medicao`,
      '',
      'Obrigado,',
      usuario?.nome ?? '',
      'Grupo Emais',
    ].join('\n');
    // Em cópia oculta: cada fornecedor não vê o e-mail dos outros.
    const link = `mailto:?bcc=${emails.join(';')}&subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;
    window.location.href = link;
    try {
      await registrarCobranca(lista.map((m) => m.id));
      setOk(`Cobrança aberta no Outlook para ${lista.length} ${lista.length === 1 ? 'empresa' : 'empresas'}. A data da cobrança ficou registrada.`);
      setSelecao(new Set());
      setMedicoes(await lerMedicoes({ competencia }));
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    }
  }

  const carregando = !medicoes || !alocacoes;

  return (
    <Pagina
      titulo="Medição mensal"
      apoio="Conferência dos documentos do F.48 que os fornecedores enviam todo mês, por obra. Entrega até o dia 25 do mês seguinte ao trabalhado."
      acoes={
        <button type="button" className="botao botao-secundario" onClick={() => setRetencao(true)} disabled={carregando}>
          Aviso de retenção
        </button>
      }
    >
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {ok && <Mensagem tipo="ok" aoFechar={() => setOk(null)}>{ok}</Mensagem>}

      <div className="filtros">
        <label className="campo">
          <span>Mês trabalhado</span>
          <select value={competencia} onChange={(e) => aoMudarMes(e.target.value)}>
            {mesesDoPainel().map((c) => (
              <option key={c} value={c}>{mesPorExtenso(c)}</option>
            ))}
          </select>
        </label>
        <label className="campo campo-busca">
          <span>Buscar</span>
          <input type="search" placeholder="Empresa ou obra" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </label>
      </div>

      {carregando && !erro && <Carregando />}

      {!carregando && (
        <>
          <div className="chips chips-filtro" role="group" aria-label="Filtrar medições">
            {(
              [
                ['todas', 'Todas', contagem.todas],
                ['em_analise', 'Para conferir', contagem.em_analise],
                ['pendente', 'Com o fornecedor', contagem.pendente],
                ['retidas', 'Retidas', contagem.retidas],
                ['aprovadas', 'Aprovadas', contagem.aprovadas],
                ['nao_iniciadas', 'Não começaram', contagem.nao_iniciadas],
              ] as [Filtro, string, number][]
            ).map(([f, rotulo, n]) => (
              <button key={f} type="button" className="chip" aria-pressed={filtro === f} onClick={() => setFiltro(f)}>
                {rotulo} <span className="chip-numero">{n}</span>
              </button>
            ))}
          </div>
          <p className="dica">
            Prazo de {mesPorExtenso(competencia)}: {data(prazoDe(competencia))}. Entregues no prazo: {contagem.no_prazo} de {contagem.todas}.
          </p>

          {filtro !== 'nao_iniciadas' && (
            <section className="bloco">
              {cobraveis.length > 0 && (
                <div className="barra-lista">
                  <span className="dica">
                    {selecao.size > 0 ? `${selecao.size} ${selecao.size === 1 ? 'selecionada' : 'selecionadas'}` : 'Marque as empresas para cobrar de uma vez.'}
                  </span>
                  <span className="linha-botoes">
                    <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => setSelecao(new Set(cobraveis.map((m) => m.id)))}>
                      Marcar as {cobraveis.length} com pendência
                    </button>
                    <button type="button" className="botao botao-pequeno" disabled={selecionadas.length === 0} onClick={() => cobrar(selecionadas)}>
                      Cobrar por e-mail
                    </button>
                  </span>
                </div>
              )}
              <div className="tabela-rolagem">
                <table className="tabela tabela-lista">
                  <thead>
                    <tr>
                      <th scope="col"><span className="sr">Marcar</span></th>
                      <th scope="col">Empresa</th>
                      <th scope="col">Obra</th>
                      <th scope="col">Situação</th>
                      <th scope="col">Entrega</th>
                      <th scope="col">O que falta</th>
                      <th scope="col">Cobrança</th>
                      <th scope="col"><span className="sr">Abrir</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiveis.length === 0 && (
                      <tr>
                        <td colSpan={8} className="vazio-linha">Nenhuma medição neste filtro.</td>
                      </tr>
                    )}
                    {visiveis.map((m) => (
                      <tr key={m.id}>
                        <td>
                          {m.status !== 'aprovada' && m.status !== 'em_analise' && (
                            <input type="checkbox" aria-label={`Marcar ${m.empresa}`} checked={selecao.has(m.id)} onChange={() => alternar(m.id)} />
                          )}
                        </td>
                        <th scope="row">
                          {m.empresa}
                          <small className="sub">{formatarCnpj(m.cnpj)}{m.email_cobranca ? '' : ', sem e-mail'}</small>
                        </th>
                        <td>{m.obra ?? <span className="sub">Sem obra (planilha)</span>}</td>
                        <td>
                          <span className={`selo ${seloMedicao[m.status]}`}>{rotuloStatusMedicao[m.status]}</span>
                          {m.retida && <small className="sub texto-erro">retida</small>}
                        </td>
                        <td>
                          {m.primeiro_envio_em ? data(m.primeiro_envio_em) : <span className="sub">Não enviada</span>}
                          {m.primeiro_envio_em && <small className={m.entregue_no_prazo ? 'sub' : 'sub texto-alerta'}>{m.entregue_no_prazo ? 'no prazo' : 'fora do prazo'}</small>}
                        </td>
                        <td>{oQueFalta(m)}</td>
                        <td>{m.ultima_cobranca_em ? data(m.ultima_cobranca_em) : <span className="sub">Nunca</span>}</td>
                        <td className="acoes">
                          <Link className={m.status === 'em_analise' ? 'botao botao-pequeno' : 'botao botao-secundario botao-pequeno'} to={`/medicao?m=${m.id}&mes=${competencia}`}>
                            {m.status === 'em_analise' ? 'Conferir' : 'Abrir'}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {filtro === 'nao_iniciadas' && (
            <section className="bloco">
              <p className="apoio">
                Empresas com colaboradores liberados na obra que ainda não começaram a medição de {mesPorExtenso(competencia)}.
              </p>
              <div className="tabela-rolagem">
                <table className="tabela tabela-lista tabela-compacta">
                  <thead>
                    <tr>
                      <th scope="col">Empresa</th>
                      <th scope="col">Obra</th>
                      <th scope="col">Liberados hoje</th>
                    </tr>
                  </thead>
                  <tbody>
                    {naoIniciadasVisiveis.length === 0 && (
                      <tr>
                        <td colSpan={3} className="vazio-linha">Todas as empresas com liberados já começaram.</td>
                      </tr>
                    )}
                    {naoIniciadasVisiveis.map((n) => (
                      <tr key={`${n.empresa_id}|${n.obra_id}`}>
                        <th scope="row">{n.empresa}</th>
                        <td>{n.obra}</td>
                        <td>{n.liberados}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      <AvisoRetencao
        aberto={retencao}
        aoFechar={() => setRetencao(false)}
        competencia={competencia}
        medicoes={medicoes ?? []}
        naoIniciadas={naoIniciadas}
        assinatura={usuario?.nome ?? ''}
        aoCopiar={() => setOk('Texto copiado.')}
      />
    </Pagina>
  );
}

function prazoDe(competencia: string): string {
  const [a, m] = competencia.split('-').map(Number);
  return new Date(Date.UTC(a, m, 25)).toISOString().slice(0, 10);
}

function ordemPainel(m: Medicao): number {
  if (m.status === 'em_analise') return 0;
  if (m.retida) return 1;
  if (m.status === 'pendente_fornecedor') return 2;
  if (m.status === 'aberta') return 3;
  return 4;
}

function oQueFalta(m: Medicao): string {
  if (m.status === 'aprovada') return '';
  const partes: string[] = [];
  if (m.itens_em_analise > 0) partes.push(`${m.itens_em_analise} para conferir`);
  if (m.itens_devolvidos > 0) partes.push(`${m.itens_devolvidos} devolvidos`);
  const naoEnviados = m.itens_pendentes - m.itens_devolvidos;
  if (naoEnviados > 0) partes.push(`${naoEnviados} não enviados`);
  if (m.colaboradores_pendentes > 0) partes.push(`${m.colaboradores_pendentes} colab. com pendência`);
  return partes.join(', ');
}

// ---------------------------------------------------------------- Aviso de retenção para a engenharia da obra

function AvisoRetencao({
  aberto, aoFechar, competencia, medicoes, naoIniciadas, assinatura, aoCopiar,
}: {
  aberto: boolean;
  aoFechar: () => void;
  competencia: string;
  medicoes: Medicao[];
  naoIniciadas: NaoIniciada[];
  assinatura: string;
  aoCopiar: () => void;
}) {
  const obras = useMemo(() => {
    const m = new Map<string, string>();
    medicoes.forEach((x) => x.obra_id && x.obra && m.set(x.obra_id, x.obra));
    naoIniciadas.forEach((x) => m.set(x.obra_id, x.obra));
    return [...m.entries()].sort(([, a], [, b]) => a.localeCompare(b, 'pt-BR'));
  }, [medicoes, naoIniciadas]);
  const [obra, setObra] = useState('');
  const [para, setPara] = useState('');

  useEffect(() => {
    if (aberto && !obra && obras.length > 0) setObra(obras[0][0]);
  }, [aberto, obra, obras]);

  useEffect(() => {
    if (obra) setPara(lerDestino(obra));
  }, [obra]);

  const nomeObra = obras.find(([id]) => id === obra)?.[1] ?? '';
  const naoAprovadas = medicoes.filter((m) => m.obra_id === obra && m.status !== 'aprovada');
  const semMedicao = naoIniciadas.filter((n) => n.obra_id === obra);
  const aprovadas = medicoes.filter((m) => m.obra_id === obra && m.status === 'aprovada');
  const mes = mesPorExtenso(competencia);

  const linhas = [
    ...naoAprovadas.map((m) => `- ${m.empresa}: ${m.status === 'em_analise' ? 'em conferência na Emais' : 'documentos pendentes'}`),
    ...semMedicao.map((n) => `- ${n.empresa}: medição não enviada`),
  ];
  const assunto = `Medição de ${mes}, ${nomeObra}: pagamentos retidos`;
  const corpo = [
    'Olá,',
    '',
    linhas.length > 0
      ? `Na obra ${nomeObra}, as empresas abaixo ainda não têm a medição de ${mes} aprovada. O pagamento delas deve ficar retido até a aprovação:`
      : `Na obra ${nomeObra}, todas as empresas com medição de ${mes} estão aprovadas.`,
    '',
    ...linhas,
    ...(linhas.length > 0 ? [''] : []),
    ...(aprovadas.length > 0 ? [`Aprovadas e liberadas para pagamento: ${aprovadas.map((m) => m.empresa).join('; ')}.`, ''] : []),
    'Assim que alguma for aprovada, aviso.',
    '',
    'Obrigado,',
    assinatura,
    'Grupo Emais',
  ].join('\n');

  return (
    <Dialogo aberto={aberto} titulo="Aviso de retenção para a obra" aoFechar={aoFechar} largura="larga">
      <div className="formulario formulario-largo">
        <div className="grade-2">
          <label className="campo">
            <span>Obra</span>
            <select value={obra} onChange={(e) => setObra(e.target.value)}>
              {obras.map(([id, nome]) => (
                <option key={id} value={id}>{nome}</option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span>Para (engenharia da obra)</span>
            <input type="text" value={para} onChange={(e) => setPara(e.target.value)} placeholder="engenheiro@emais.com; adm.obra@emais.com" />
          </label>
        </div>
        <div className="previa-email">
          <p><span className="sub">Assunto</span> {assunto}</p>
          <pre>{corpo}</pre>
          <div className="linha-botoes">
            <a className="botao" href={linkOutlook(para, assunto, corpo)} onClick={() => guardarDestino(obra, para.trim())}>
              Abrir no Outlook
            </a>
            <button type="button" className="botao botao-secundario" onClick={() => copiarTexto(corpo).then(aoCopiar).catch(() => undefined)}>
              Copiar texto
            </button>
          </div>
        </div>
        <p className="dica">Os destinatários de cada obra ficam lembrados neste computador.</p>
      </div>
    </Dialogo>
  );
}

// ---------------------------------------------------------------- Conferência de uma medição

const CICLO: (Marcacao | undefined)[] = [undefined, 'ok', 'pendente', 'na'];
const SIMBOLO: Record<Marcacao, string> = { ok: 'OK', pendente: 'Pend.', na: 'N/A' };

function DetalheAdmin({ id, aoVoltar }: { id: string; aoVoltar: () => void }) {
  const { usuario } = useSessao();
  const [detalhe, setDetalhe] = useState<DetalheMedicao | null>(null);
  const [tipos, setTipos] = useState<TipoMedicao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [devolvendo, setDevolvendo] = useState<{ item: ItemMedicao; tipo: TipoMedicao } | null>(null);
  const [baixando, setBaixando] = useState(false);
  const [cobranca, setCobranca] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setDetalhe(await lerMedicao(id));
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    }
  }, [id]);

  useEffect(() => {
    carregar();
    lerTiposMedicao().then(setTipos).catch((e) => setErro(mensagemDeErro(e)));
  }, [carregar]);

  async function executar(chave: string, acao: () => Promise<void>, sucesso?: string) {
    setErro(null);
    setOk(null);
    setOcupado(chave);
    try {
      await acao();
      await carregar();
      if (sucesso) setOk(sucesso);
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setOcupado(null);
    }
  }

  // Marcação de um colaborador: atualiza na tela na hora e grava em seguida.
  async function marcar(l: LinhaColaborador, conferencia: LinhaColaborador['conferencia'], situacao?: SituacaoColaborador) {
    setErro(null);
    setDetalhe((d) => d && { ...d, colaboradores: d.colaboradores.map((x) => (x.id === l.id ? { ...x, conferencia, situacao: situacao ?? x.situacao } : x)) });
    try {
      await conferirColaborador(l.id, conferencia, situacao);
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
      await carregar();
    }
  }

  async function marcarTudoOk() {
    if (!detalhe) return;
    setOcupado('tudo');
    setErro(null);
    try {
      const alvo = detalhe.colaboradores.filter((l) => l.situacao === 'trabalhou');
      await Promise.all(
        alvo.map((l) => {
          const c = { ...l.conferencia };
          CHAVES_CONFERENCIA.forEach((k) => {
            if (c[k] !== 'na') c[k] = 'ok';
          });
          return conferirColaborador(l.id, c);
        }),
      );
      setOk(`${alvo.length} colaboradores marcados como OK. Ajuste quem tiver pendência.`);
      await carregar();
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setOcupado(null);
    }
  }

  if (!detalhe || !tipos) {
    return (
      <Pagina titulo="Medição mensal">
        {erro ? <Mensagem tipo="erro">{erro}</Mensagem> : <Carregando />}
      </Pagina>
    );
  }

  const { medicao: m, itens, colaboradores: linhas } = detalhe;
  const itemPorTipo = new Map(itens.map((i) => [i.tipo_codigo, i]));
  const emAnalise = itens.filter((i) => i.status === 'em_analise').length;
  const totalArquivos = itens.reduce((n, i) => n + arquivosAtuais(i).filter((a) => !a.apagado_em).length, 0);
  const daPlanilha = m.origem === 'migracao';

  return (
    <Pagina
      titulo={`${m.empresa}, ${mesCurto(m.competencia)}`}
      apoio={`${m.obra ? `Obra ${m.obra}` : 'Controle anterior, sem obra'}. Medição de ${mesPorExtenso(m.competencia)}, entrega até ${data(m.prazo)}.`}
      acoes={
        <button type="button" className="botao botao-discreto" onClick={aoVoltar}>
          Voltar ao painel
        </button>
      }
    >
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {ok && <Mensagem tipo="ok" aoFechar={() => setOk(null)}>{ok}</Mensagem>}

      <dl className="ficha caixa">
        <div>
          <dt>Situação</dt>
          <dd>
            <span className={`selo ${seloMedicao[m.status]}`}>{rotuloStatusMedicao[m.status]}</span>
            {m.retida && <span className="texto-erro"> retida</span>}
          </dd>
        </div>
        <div>
          <dt>Primeiro envio</dt>
          <dd>{m.primeiro_envio_em ? `${data(m.primeiro_envio_em)}, ${m.entregue_no_prazo ? 'no prazo' : 'fora do prazo'}` : 'Não enviada'}</dd>
        </div>
        <div>
          <dt>Última conferência</dt>
          <dd>{m.ultima_analise_em ? `${data(m.ultima_analise_em)}${m.conferente ? `, ${m.conferente}` : ''}` : 'Nenhuma'}</dd>
        </div>
        <div>
          <dt>CNPJ</dt>
          <dd>{formatarCnpj(m.cnpj)}</dd>
        </div>
        <div>
          <dt>E-mail de cobrança</dt>
          <dd>{m.email_cobranca ?? 'Não cadastrado'}</dd>
        </div>
        <div>
          <dt>Última cobrança</dt>
          <dd>{m.ultima_cobranca_em ? data(m.ultima_cobranca_em) : 'Nunca'}</dd>
        </div>
        {m.observacao && (
          <div>
            <dt>Observação</dt>
            <dd>{m.observacao}</dd>
          </div>
        )}
      </dl>

      {daPlanilha && <p className="aviso aviso-ok">Medição trazida da planilha de controle. Os arquivos dela estão no SharePoint, não no portal.</p>}

      <section className="bloco">
        <div className="barra-lista">
          <h2 className="bloco-titulo">Documentos</h2>
          {totalArquivos > 0 && (
            <span className="filtros-acao">
              <button
                type="button"
                className="botao botao-pequeno"
                disabled={baixando}
                onClick={async () => {
                  setBaixando(true);
                  setErro(null);
                  try {
                    const n = await baixarMedicao(detalhe, (f, t) => setOk(`Baixando ${f} de ${t} arquivos`));
                    setOk(`${n} ${n === 1 ? 'arquivo baixado' : 'arquivos baixados'} num ZIP, já com o nome padronizado. O prazo de 30 dias para apagar começa agora.`);
                    await carregar();
                  } catch (e) {
                    setErro(mensagemDeErro(e as Error));
                  } finally {
                    setBaixando(false);
                  }
                }}
              >
                {baixando ? 'Preparando ZIP' : `Baixar todos (${totalArquivos})`}
              </button>
              <small className="dica">Nome dos arquivos: AAAAMM_documento_empresa</small>
            </span>
          )}
        </div>
        <div className="tabela-rolagem">
          <table className="tabela tabela-lista">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Situação</th>
                <th scope="col">Arquivo</th>
                <th scope="col"><span className="sr">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {tipos.map((t) => {
                const item = itemPorTipo.get(t.codigo);
                if (!item) return null;
                const arquivos = arquivosAtuais(item);
                const ativos = arquivos.filter((a) => !a.apagado_em);
                return (
                  <tr key={t.codigo}>
                    <th scope="row">
                      {t.item}. {t.nome}
                      {t.coletivo && <small className="sub">Conferido por colaborador</small>}
                    </th>
                    <td>
                      <span className={`selo ${seloItem[item.status]}`}>{rotuloStatusItem[item.status]}</span>
                      {item.status === 'devolvido' && item.motivo_devolucao && <small className="sub texto-erro">{item.motivo_devolucao}</small>}
                      {item.justificativa && <small className="sub">Não se aplica: {item.justificativa}</small>}
                    </td>
                    <td>
                      {arquivos.length === 0 && <span className="sub">{item.justificativa ? '' : 'Sem arquivo'}</span>}
                      {arquivos.map((a) => (
                        <div key={a.id} className="arquivo">
                          {a.apagado_em ? (
                            <span className="sub">{a.nome_original} (apagado)</span>
                          ) : (
                            <>
                              <button type="button" className="link-botao" title={a.nome_original} onClick={() => abrirArquivoMedicao(a.caminho).catch((e) => setErro(mensagemDeErro(e)))}>
                                {nomeArquivoMedicao(m, item, a, ativos.indexOf(a) + 1, ativos.length)}
                              </button>
                              <small className="sub">
                                {tamanhoArquivo(a.tamanho_bytes)}, enviado em {data(a.enviado_em)}
                                {a.baixado_em ? `, baixado em ${data(a.baixado_em)}` : ''}
                              </small>
                              <button
                                type="button"
                                className="botao botao-discreto botao-pequeno"
                                onClick={() => executar(a.id, () => baixarArquivoMedicao(m, item, a))}
                              >
                                Baixar
                              </button>
                            </>
                          )}
                        </div>
                      ))}
                      {item.versao > 1 && <small className="sub">Envio nº {item.versao}</small>}
                    </td>
                    <td className="acoes">
                      {item.status === 'em_analise' && (
                        <>
                          <button
                            type="button"
                            className="botao botao-pequeno"
                            disabled={ocupado === item.id}
                            onClick={() => executar(item.id, () => avaliarItem(item.id, true), `${t.nome}: ${item.justificativa ? 'não se aplica confirmado' : 'aprovado'}.`)}
                          >
                            {item.justificativa ? 'Aceitar' : 'Aprovar'}
                          </button>
                          <button type="button" className="botao botao-secundario botao-pequeno" disabled={ocupado === item.id} onClick={() => setDevolvendo({ item, tipo: t })}>
                            Devolver
                          </button>
                        </>
                      )}
                      {(item.status === 'aprovado' || item.status === 'nao_aplica') && !daPlanilha && (
                        <button type="button" className="botao botao-discreto botao-pequeno" disabled={ocupado === item.id} onClick={() => setDevolvendo({ item, tipo: t })}>
                          Devolver
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bloco">
        <div className="barra-lista">
          <h2 className="bloco-titulo">
            Conferência por colaborador <span className="sub">{linhas.length}</span>
          </h2>
          {linhas.length > 0 && (
            <button type="button" className="botao botao-secundario botao-pequeno" disabled={ocupado === 'tudo'} onClick={marcarTudoOk}>
              Marcar tudo OK
            </button>
          )}
        </div>
        <p className="dica">Clique na célula para alternar: vazio, OK, pendente, N/A. Cada clique grava na hora.</p>
        <div className="tabela-rolagem">
          <table className="tabela tabela-compacta tabela-conferencia">
            <thead>
              <tr>
                <th scope="col">Colaborador</th>
                <th scope="col">Situação</th>
                {CHAVES_CONFERENCIA.map((k) => (
                  <th key={k} scope="col">{rotuloConferencia[k]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.length === 0 && (
                <tr>
                  <td colSpan={2 + CHAVES_CONFERENCIA.length} className="vazio-linha">O fornecedor ainda não informou os colaboradores do mês.</td>
                </tr>
              )}
              {linhas.map((l) => (
                <tr key={l.id}>
                  <th scope="row">
                    {l.nome}
                    {!l.colaborador_id && <small className="sub">fora do cadastro do portal</small>}
                    {l.observacao && <small className="sub">{l.observacao}</small>}
                  </th>
                  <td>
                    <select aria-label={`Situação de ${l.nome}`} value={l.situacao} onChange={(e) => marcar(l, l.conferencia, e.target.value as SituacaoColaborador)}>
                      {(Object.keys(rotuloSituacaoColaborador) as SituacaoColaborador[]).map((s) => (
                        <option key={s} value={s}>{rotuloSituacaoColaborador[s]}</option>
                      ))}
                    </select>
                  </td>
                  {CHAVES_CONFERENCIA.map((k) => {
                    const v = l.conferencia[k];
                    return (
                      <td key={k}>
                        <button
                          type="button"
                          className={`marca marca-${v ?? 'vazia'}`}
                          aria-label={`${rotuloConferencia[k]} de ${l.nome}: ${v ? SIMBOLO[v] : 'sem marcação'}`}
                          onClick={() => {
                            const proximo = CICLO[(CICLO.indexOf(v) + 1) % CICLO.length];
                            const c: Partial<Record<ChaveConferencia, Marcacao>> = { ...l.conferencia };
                            if (proximo) c[k] = proximo;
                            else delete c[k];
                            marcar(l, c);
                          }}
                        >
                          {v ? SIMBOLO[v] : ''}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {!daPlanilha || m.status !== 'aprovada' ? (
        <section className="bloco zona-final">
          <p className="apoio">
            {emAnalise > 0
              ? `Faltam ${emAnalise} ${emAnalise === 1 ? 'item' : 'itens'} para conferir antes de concluir.`
              : 'Ao concluir, a medição fica aprovada se não houver item faltando nem colaborador pendente. Se houver, ela volta para o fornecedor.'}
          </p>
          <div className="linha-botoes">
            <button
              type="button"
              className="botao"
              disabled={emAnalise > 0 || ocupado === 'concluir'}
              onClick={() =>
                executar('concluir', async () => {
                  const novo = await concluirConferencia(m.id);
                  if (novo === 'pendente_fornecedor') setCobranca(true);
                  setOk(novo === 'aprovada' ? 'Medição aprovada.' : 'Conferência concluída. A medição voltou para o fornecedor com as pendências.');
                })
              }
            >
              Concluir conferência
            </button>
            {m.status !== 'aprovada' && (
              <button type="button" className="botao botao-secundario" onClick={() => setCobranca(true)}>
                Cobrar o fornecedor
              </button>
            )}
          </div>
        </section>
      ) : null}

      <Devolucao
        alvo={devolvendo}
        aoFechar={() => setDevolvendo(null)}
        aoDevolver={(motivo) => {
          const d = devolvendo!;
          setDevolvendo(null);
          executar(d.item.id, () => avaliarItem(d.item.id, false, motivo), `${d.tipo.nome} devolvido ao fornecedor.`);
        }}
      />

      <Cobranca
        aberto={cobranca}
        aoFechar={() => setCobranca(false)}
        detalhe={detalhe}
        tipos={tipos}
        assinatura={usuario?.nome ?? ''}
        aoAbrir={async () => {
          try {
            await registrarCobranca([m.id]);
            await carregar();
          } catch (e) {
            setErro(mensagemDeErro(e as Error));
          }
        }}
        aoCopiar={() => setOk('Texto copiado.')}
      />
    </Pagina>
  );
}

const MOTIVOS = ['Arquivo ilegível ou cortado', 'Falta colaborador da lista', 'Documento de outro mês', 'Falta assinatura', 'Falta comprovante de pagamento'];

function Devolucao({ alvo, aoFechar, aoDevolver }: { alvo: { item: ItemMedicao; tipo: TipoMedicao } | null; aoFechar: () => void; aoDevolver: (m: string) => void }) {
  const [motivo, setMotivo] = useState('');
  useEffect(() => setMotivo(''), [alvo]);

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (motivo.trim()) aoDevolver(motivo.trim());
  }

  return (
    <Dialogo aberto={!!alvo} titulo="Devolver item" aoFechar={aoFechar}>
      {alvo && (
        <form className="formulario formulario-largo" onSubmit={enviar}>
          <p className="apoio">
            {alvo.tipo.item}. {alvo.tipo.nome}. O fornecedor vê o motivo na medição e envia de novo.
          </p>
          <div className="chips" role="group" aria-label="Motivos comuns">
            {MOTIVOS.map((x) => (
              <button key={x} type="button" className="chip" onClick={() => setMotivo(x)}>
                {x}
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

function Cobranca({
  aberto, aoFechar, detalhe, tipos, assinatura, aoAbrir, aoCopiar,
}: {
  aberto: boolean;
  aoFechar: () => void;
  detalhe: DetalheMedicao;
  tipos: TipoMedicao[];
  assinatura: string;
  aoAbrir: () => void;
  aoCopiar: () => void;
}) {
  const { medicao: m, itens, colaboradores } = detalhe;
  const itemPorTipo = new Map(itens.map((i) => [i.tipo_codigo, i]));
  const faltando = tipos
    .map((t) => ({ t, i: itemPorTipo.get(t.codigo) }))
    .filter(({ i }) => i && (i.status === 'nao_enviado' || i.status === 'devolvido'))
    .map(({ t, i }) => `- ${t.item}. ${t.nome}${i!.status === 'devolvido' && i!.motivo_devolucao ? ` (devolvido: ${i!.motivo_devolucao})` : ''}`);
  const pendentes = colaboradores
    .map((l) => ({ l, ks: CHAVES_CONFERENCIA.filter((k) => l.conferencia[k] === 'pendente') }))
    .filter((x) => x.ks.length > 0)
    .map(({ l, ks }) => `- ${l.nome}: ${ks.map((k) => rotuloConferencia[k].toLowerCase()).join(', ')}`);
  const mes = mesPorExtenso(m.competencia);
  const assunto = `Medição de ${mes}${m.obra ? `, ${m.obra}` : ''}: pendências da ${m.empresa}`;
  const corpo = [
    'Olá,',
    '',
    `Conferimos a medição de ${mes} da ${m.empresa}${m.obra ? ` na obra ${m.obra}` : ''} e ainda falta:`,
    '',
    ...(faltando.length > 0 ? ['Documentos:', ...faltando, ''] : []),
    ...(pendentes.length > 0 ? ['Colaboradores com pendência:', ...pendentes, ''] : []),
    ...(faltando.length === 0 && pendentes.length === 0 ? ['- Enviar a medição para conferência no portal', ''] : []),
    `O prazo de entrega é ${data(m.prazo)}. Sem a medição aprovada, o pagamento fica retido.`,
    '',
    `Envie pelo Portal de Terceiros, em Medição: ${enderecoDoSite}medicao`,
    '',
    'Obrigado,',
    assinatura,
    'Grupo Emais',
  ].join('\n');

  return (
    <Dialogo aberto={aberto} titulo="Cobrar o fornecedor" aoFechar={aoFechar} largura="larga">
      <div className="formulario formulario-largo">
        <div className="previa-email">
          <p><span className="sub">Para</span> {m.email_cobranca ?? 'sem e-mail cadastrado'}</p>
          <p><span className="sub">Assunto</span> {assunto}</p>
          <pre>{corpo}</pre>
          <div className="linha-botoes">
            <a className="botao" href={linkOutlook(m.email_cobranca ?? '', assunto, corpo)} onClick={aoAbrir}>
              Abrir no Outlook
            </a>
            <button type="button" className="botao botao-secundario" onClick={() => copiarTexto(corpo).then(aoCopiar).catch(() => undefined)}>
              Copiar texto
            </button>
          </div>
        </div>
        <p className="dica">Ao abrir no Outlook, a data da cobrança fica registrada.</p>
      </div>
    </Dialogo>
  );
}
