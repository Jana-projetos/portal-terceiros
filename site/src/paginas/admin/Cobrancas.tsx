import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Carregando } from '../../componentes/Carregando';
import { mensagemDeErro } from '../../lib/supabase';
import { useSessao } from '../../lib/sessao';
import { data, hojeIso } from '../../lib/formato';
import { copiarTexto, linkOutlook } from '../../lib/admin';
import { guardarDestinatariosObra, montarFila, registrarCobrancas, titulosGrupo, type Cobranca, type Fila, type TipoCobranca } from '../../lib/cobrancas';

const ORDEM: TipoCobranca[] = ['lembrete_medicao', 'cobranca_medicao', 'retencao_obra', 'vencimento_documento'];
const LIMITE_LINK = 1900;

export function Cobrancas() {
  const { usuario } = useSessao();
  const [fila, setFila] = useState<Fila | null>(null);
  const [para, setPara] = useState<Map<string, string>>(new Map());
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [feitas, setFeitas] = useState<Set<string>>(new Set());

  const carregar = useCallback(async () => {
    try {
      const f = await montarFila(usuario?.nome ?? '');
      setFila(f);
      setPara(new Map(f.cobrancas.map((c) => [c.chave, c.para])));
      setFeitas(new Set());
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    }
  }, [usuario?.nome]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const abertas = useMemo(() => (fila?.cobrancas ?? []).filter((c) => !feitas.has(c.chave)), [fila, feitas]);

  async function registrar(lista: Cobranca[], situacao: 'aberta_no_outlook' | 'dispensada') {
    setErro(null);
    try {
      for (const c of lista) {
        if (c.obraId && situacao === 'aberta_no_outlook') await guardarDestinatariosObra(c.obraId, para.get(c.chave) ?? '');
      }
      await registrarCobrancas(lista, situacao, para);
      setFeitas((s) => new Set([...s, ...lista.map((c) => c.chave)]));
      setOk(
        situacao === 'dispensada'
          ? `${lista.length === 1 ? 'Cobrança dispensada' : `${lista.length} cobranças dispensadas`}. ${lista.length === 1 ? 'Ela não volta' : 'Elas não voltam'} para a lista.`
          : `E-mail para ${lista[0].titulo} aberto no Outlook. Confira e clique em enviar.`,
      );
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    }
  }

  return (
    <Pagina
      titulo="Cobranças do dia"
      apoio="O portal monta os e-mails no calendário combinado. Confira cada um, clique em Abrir no Outlook e envie de lá. O que foi aberto ou dispensado sai da lista."
    >
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {ok && <Mensagem tipo="ok" aoFechar={() => setOk(null)}>{ok}</Mensagem>}
      {!fila && !erro && <Carregando />}

      {fila && (
        <>
          <div className="bloco-destaque">
            <strong>
              Hoje, {data(hojeIso())}: {abertas.length === 0 ? 'nenhum e-mail para enviar' : `${abertas.length} ${abertas.length === 1 ? 'e-mail pronto' : 'e-mails prontos'}`}.
            </strong>{' '}
            Calendário: lembrete da medição no dia 20, cobrança e aviso de retenção no dia 26, documentos quando entram em 30 dias, em 15 dias e quando vencem. Próxima rodada da medição: {data(fila.proxima)}.
            <details className="ajuda">
              <summary>O botão não abre o Outlook do computador?</summary>
              <p>
                O botão abre o programa de e-mail padrão do Windows. Para ser o Outlook: Configurações &gt; Aplicativos &gt; Aplicativos padrão &gt; Outlook, e em
                MAILTO escolha Outlook. Se abrir o Gmail no navegador, remova o Gmail em chrome://settings/handlers (no Edge, edge://settings/content/handlers).
              </p>
            </details>
          </div>

          {ORDEM.map((tipo) => {
            const doGrupo = abertas.filter((c) => c.tipo === tipo);
            if (doGrupo.length === 0) return null;
            return (
              <section key={tipo} className="bloco">
                <div className="barra-lista">
                  <h2 className="bloco-titulo">
                    {titulosGrupo[tipo].titulo} <span className="sub">{doGrupo.length}</span>
                  </h2>
                  <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => registrar(doGrupo, 'dispensada')}>
                    Dispensar todos deste grupo
                  </button>
                </div>
                <p className="dica">{titulosGrupo[tipo].apoio}</p>
                <ul className="lista-cobrancas">
                  {doGrupo.map((c) => {
                    const destino = para.get(c.chave) ?? '';
                    const link = linkOutlook(destino, c.assunto, c.corpo);
                    const semEmail = !destino.includes('@');
                    return (
                      <li key={c.chave} className="cobranca">
                        <div className="cobranca-topo">
                          <strong>{c.titulo}</strong>
                          <span className="sub">{c.resumo}</span>
                        </div>
                        <label className="campo campo-compacto">
                          <span>Para</span>
                          <input
                            type="text"
                            value={destino}
                            placeholder={c.tipo === 'retencao_obra' ? 'e-mail da engenharia da obra' : 'e-mail do fornecedor'}
                            aria-invalid={semEmail}
                            onChange={(e) => setPara((m) => new Map(m).set(c.chave, e.target.value))}
                          />
                          {semEmail && <small className="campo-erro">{c.tipo === 'retencao_obra' ? 'Informe quem recebe nesta obra. Fica guardado para os próximos meses.' : 'Empresa sem e-mail cadastrado. Informe para abrir.'}</small>}
                        </label>
                        <p className="cobranca-assunto"><span className="sub">Assunto</span> {c.assunto}</p>
                        <details>
                          <summary>Ver o texto</summary>
                          <pre className="cobranca-texto">{c.corpo}</pre>
                        </details>
                        {link.length > LIMITE_LINK && <small className="dica">Texto longo: se o Outlook abrir o e-mail cortado, use "Copiar texto" e cole.</small>}
                        <div className="linha-botoes">
                          {semEmail ? (
                            <button type="button" className="botao" disabled>Abrir no Outlook</button>
                          ) : (
                            <a className="botao" href={link} onClick={() => registrar([c], 'aberta_no_outlook')}>
                              Abrir no Outlook
                            </a>
                          )}
                          <button
                            type="button"
                            className="botao botao-secundario"
                            onClick={() => copiarTexto(c.corpo).then(() => setOk('Texto copiado.')).catch(() => setErro('O navegador não deixou copiar. Abra "Ver o texto", selecione e copie.'))}
                          >
                            Copiar texto
                          </button>
                          <button type="button" className="botao botao-discreto" onClick={() => registrar([c], 'dispensada')}>
                            Dispensar
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}

          {abertas.length === 0 && (
            <p className="vazio">Tudo em dia por aqui. Os próximos e-mails aparecem sozinhos quando chegar a data.</p>
          )}
        </>
      )}
    </Pagina>
  );
}
