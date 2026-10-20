import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Carregando } from '../../componentes/Carregando';
import { Barras, Cartao, Colunas } from '../../componentes/Graficos';
import { mensagemDeErro } from '../../lib/supabase';
import { mesCurto, mesPorExtenso } from '../../lib/medicao';
import {
  METAS, calcularLiberacao, calcularMedicao, lerBaseIndicadores, melhoresMedicao, obrasDaBase, pioresMedicao,
  type BaseIndicadores,
} from '../../lib/indicadores';

const INICIO = '2026-03-01';

function mesesAtras(n: number): string {
  const h = new Date();
  const d = new Date(h.getFullYear(), h.getMonth() - n + 1, 1);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  return iso < INICIO ? INICIO : iso;
}

const porcento = (v: number) => `${Math.round(v)}%`;
const dias = (v: number) => `${v.toFixed(1).replace('.', ',').replace(',0', '')} d`;
const diasLongo = (v: number | null) => (v === null ? 'sem registro' : `${v.toFixed(1).replace('.', ',').replace(',0', '')} ${v === 1 ? 'dia útil' : 'dias úteis'}`);
const inteiro = (v: number) => String(Math.round(v));

export function Indicadores() {
  const [base, setBase] = useState<BaseIndicadores | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [obraId, setObraId] = useState('');
  const [desde, setDesde] = useState(INICIO);

  useEffect(() => {
    lerBaseIndicadores()
      .then(setBase)
      .catch((e) => setErro(mensagemDeErro(e)));
  }, []);

  const obras = useMemo(() => (base ? obrasDaBase(base) : []), [base]);
  const med = useMemo(() => (base ? calcularMedicao(base, { obraId, desde }) : null), [base, obraId, desde]);
  const lib = useMemo(() => (base ? calcularLiberacao(base, { obraId, desde }) : null), [base, obraId, desde]);

  const periodos: [string, string][] = [
    [INICIO, 'Desde março de 2026'],
    [mesesAtras(6), 'Últimos 6 meses'],
    [mesesAtras(3), 'Últimos 3 meses'],
  ];

  return (
    <Pagina titulo="Indicadores" apoio="Medição mensal e liberação de terceiros, calculados direto do portal. Os números se atualizam a cada visita.">
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}

      <div className="filtros">
        <label className="campo">
          <span>Obra</span>
          <select value={obraId} onChange={(e) => setObraId(e.target.value)}>
            <option value="">Todas as obras</option>
            {obras.map((o) => (
              <option key={o.id} value={o.id}>{o.nome}</option>
            ))}
          </select>
        </label>
        <label className="campo">
          <span>Período</span>
          <select value={desde} onChange={(e) => setDesde(e.target.value)}>
            {periodos.map(([v, r]) => (
              <option key={r} value={v}>{r}</option>
            ))}
          </select>
        </label>
      </div>
      {obraId && <p className="dica">Com uma obra escolhida, a medição não inclui o histórico da planilha, que não tem obra.</p>}

      {!base && !erro && <Carregando />}

      {med && lib && (
        <>
          <section className="bloco">
            <h2 className="bloco-titulo">Medição mensal</h2>
            <div className="cartoes">
              <CartaoAprovadas med={med} />
              <CartaoNoPrazo med={med} />
              <Cartao
                rotulo="Tempo de conferência da Emais"
                valor={med.conferenciaMedia === null ? 'Sem registro' : diasLongo(med.conferenciaMedia)}
                alerta={med.conferenciaMedia !== null && med.conferenciaMedia > METAS.conferencia}
                apoio={
                  <>
                    Média do envio à conclusão. Meta: até {METAS.conferencia} dias úteis.
                    {med.emConferenciaAgora.qtd > 0 &&
                      ` Agora: ${med.emConferenciaAgora.qtd} na fila, a mais antiga há ${diasLongo(med.emConferenciaAgora.maisAntigaDias)}.`}
                  </>
                }
              />
              <Cartao
                rotulo="Itens pendentes"
                valor={String(med.totalItensPendentes)}
                alerta={med.totalItensPendentes > 0}
                apoio={`Não enviados ou devolvidos em ${med.naoAprovadas} medições não aprovadas. Em ${med.nadaEntregue} delas, nada foi entregue.`}
              />
            </div>

            <div className="duas-colunas graficos">
              <Colunas
                titulo="Medições aprovadas, % por mês trabalhado"
                dados={med.meses.map((m) => ({
                  rotulo: mesCurto(m.competencia),
                  valor: m.pctAprovadas,
                  dica: `${m.aprovadas} de ${m.total} aprovadas${m.fechado ? '' : ', mês ainda no prazo'}`,
                }))}
                formatar={porcento}
                meta={METAS.aprovadas}
                maximo={100}
              />
              <Colunas
                titulo="Entrega no prazo, % por mês trabalhado"
                dados={med.meses.map((m) => ({
                  rotulo: mesCurto(m.competencia),
                  valor: m.pctNoPrazo,
                  dica: m.pctNoPrazo === null ? 'A planilha não tinha a data de envio' : `${m.noPrazo} de ${m.doPortal} entregues até o dia 25`,
                }))}
                formatar={porcento}
                meta={METAS.noPrazo}
                maximo={100}
                nota={med.meses.some((m) => m.pctNoPrazo === null) ? 'Meses da planilha não têm data de envio; o indicador começa com as medições do portal.' : undefined}
              />
              <Colunas
                titulo="Tempo de conferência da Emais, média em dias úteis"
                dados={(med.conferencia.length ? med.conferencia : [{ mes: med.meses[med.meses.length - 1]?.competencia ?? desde, conferencias: 0, mediaDias: null }]).map((c) => ({
                  rotulo: mesCurto(c.mes),
                  valor: c.mediaDias,
                  dica: `${c.conferencias} ${c.conferencias === 1 ? 'conferência concluída' : 'conferências concluídas'}`,
                }))}
                formatar={dias}
                meta={METAS.conferencia}
                nota={med.conferencia.length === 0 ? 'Começa a medir com as conferências feitas no portal.' : undefined}
              />
              <Barras
                titulo="Itens pendentes nas entregas parciais"
                detalhe={
                  <p className="dica">
                    Medições que entregaram parte dos itens ({med.entregaParcial}). As {med.nadaEntregue} que não entregaram nada ficam de fora, para mostrar onde o fornecedor trava.
                  </p>
                }
                dados={med.itensPendentes.map((i) => ({
                  rotulo: i.rotulo,
                  valor: i.total,
                  dica: `${i.naoEnviado} não enviados, ${i.devolvido} devolvidos`,
                }))}
                formatar={inteiro}
              />
            </div>

            <Ranking
              titulo="Fornecedores na medição"
              dica="Considera só os meses com prazo vencido. Melhores: pelo menos 2 medições."
              colunas={['Medições', 'Aprovadas', 'No prazo', 'Itens pendentes', 'Meses retidos']}
              piores={pioresMedicao(med.ranking).map((r) => ({
                chave: r.empresa_id,
                nome: r.empresa,
                valores: [r.medicoes, `${r.aprovadas} (${porcento(r.pctAprovadas)})`, r.pctNoPrazo === null ? '' : porcento(r.pctNoPrazo), r.itensPendentes, r.retidas],
              }))}
              melhores={melhoresMedicao(med.ranking).map((r) => ({
                chave: r.empresa_id,
                nome: r.empresa,
                valores: [r.medicoes, `${r.aprovadas} (${porcento(r.pctAprovadas)})`, r.pctNoPrazo === null ? '' : porcento(r.pctNoPrazo), r.itensPendentes, r.retidas],
              }))}
            />
          </section>

          <section className="bloco">
            <h2 className="bloco-titulo">Liberação de colaboradores</h2>
            <div className="cartoes">
              <Cartao
                rotulo="Tempo de liberação"
                valor={diasLongo(lib.mediaTotal)}
                alerta={lib.mediaTotal !== null && lib.mediaTotal > METAS.liberacao}
                apoio={`Média do envio para análise à validação do TST, em ${lib.liberacoes} liberações. Meta: até ${METAS.liberacao} dias úteis.`}
              />
              <Cartao rotulo="Na análise da Emais" valor={diasLongo(lib.mediaEmais)} apoio="Do envio para análise à aprovação do administrativo." />
              <Cartao rotulo="Na validação do TST" valor={diasLongo(lib.mediaTst)} apoio="Da aprovação do administrativo à validação do TST." />
              <Cartao
                rotulo="Liberados com documento vencido ou faltando"
                valor={lib.pctComPendencia === null ? '0%' : porcento(lib.pctComPendencia)}
                alerta={lib.comPendencia > 0}
                apoio={`${lib.comPendencia} de ${lib.liberados} liberados hoje. Meta: ${METAS.liberadosComPendencia}%.`}
              />
            </div>

            <div className="duas-colunas graficos">
              <Colunas
                titulo="Tempo de liberação, média em dias úteis por mês"
                dados={lib.meses.map((m) => ({
                  rotulo: mesCurto(m.mes),
                  valor: m.liberacoes ? m.mediaTotal : null,
                  dica: m.liberacoes
                    ? `${m.liberacoes} liberações. Emais ${diasLongo(m.mediaEmais)}, TST ${diasLongo(m.mediaTst)}`
                    : 'Nenhuma liberação',
                }))}
                formatar={dias}
                meta={METAS.liberacao}
              />
              {obraId ? (
                <Barras
                  titulo="Documentos vencidos ou faltando nos liberados"
                  dados={lib.porDocumento.slice(0, 12).map((d) => ({ rotulo: d.documento, valor: d.total, dica: `${d.vencido} vencidos, ${d.faltando} faltando` }))}
                  formatar={inteiro}
                />
              ) : (
                <Barras
                  titulo="Liberados com documento vencido ou faltando, % por obra"
                  dados={lib.porObra.map((o) => ({ rotulo: o.obra, valor: o.pct, dica: `${o.comPendencia} de ${o.liberados} liberados` }))}
                  formatar={porcento}
                />
              )}
            </div>
            {!obraId && (
              <Barras
                titulo="Documentos vencidos ou faltando nos liberados, por documento"
                dados={lib.porDocumento.slice(0, 12).map((d) => ({ rotulo: d.documento, valor: d.total, dica: `${d.vencido} vencidos, ${d.faltando} faltando` }))}
                formatar={inteiro}
              />
            )}

            <Ranking
              titulo="Fornecedores no tempo de liberação"
              dica={`Liberações a partir de ${mesPorExtenso(desde)}, empresas com pelo menos 3.`}
              colunas={['Liberações', 'Tempo médio']}
              piores={[...lib.rankingTempo].sort((a, b) => b.mediaDias - a.mediaDias).slice(0, 10).map((r) => ({ chave: r.empresa_id, nome: r.empresa, valores: [r.liberacoes, diasLongo(r.mediaDias)] }))}
              melhores={[...lib.rankingTempo].sort((a, b) => a.mediaDias - b.mediaDias || b.liberacoes - a.liberacoes).slice(0, 10).map((r) => ({ chave: r.empresa_id, nome: r.empresa, valores: [r.liberacoes, diasLongo(r.mediaDias)] }))}
            />

            <Ranking
              titulo="Fornecedores com documento vencido ou faltando"
              dica="Situação de hoje dos colaboradores liberados."
              colunas={['Liberados', 'Com pendência', '%']}
              piores={lib.rankingPendencia
                .filter((r) => r.comPendencia > 0)
                .sort((a, b) => b.comPendencia - a.comPendencia || b.pct - a.pct)
                .slice(0, 10)
                .map((r) => ({ chave: r.empresa_id, nome: r.empresa, valores: [r.liberados, r.comPendencia, porcento(r.pct)] }))}
              melhores={lib.rankingPendencia
                .filter((r) => r.comPendencia === 0)
                .sort((a, b) => b.liberados - a.liberados || a.empresa.localeCompare(b.empresa, 'pt-BR'))
                .slice(0, 10)
                .map((r) => ({ chave: r.empresa_id, nome: r.empresa, valores: [r.liberados, r.comPendencia, porcento(r.pct)] }))}
            />
          </section>
        </>
      )}
    </Pagina>
  );
}

function CartaoAprovadas({ med }: { med: ReturnType<typeof calcularMedicao> }) {
  const u = med.ultimoFechado;
  if (!u || u.pctAprovadas === null) return <Cartao rotulo="Medições aprovadas" valor="Sem registro" />;
  const a = med.anteriorFechado;
  const delta = a?.pctAprovadas !== null && a?.pctAprovadas !== undefined ? Math.round(u.pctAprovadas - a.pctAprovadas) : null;
  return (
    <Cartao
      rotulo="Medições aprovadas"
      valor={porcento(u.pctAprovadas)}
      alerta={u.pctAprovadas < METAS.aprovadas}
      apoio={
        <>
          {mesPorExtenso(u.competencia)}, último mês com prazo vencido: {u.aprovadas} de {u.total}.
          {delta !== null && a && ` ${delta === 0 ? 'Igual a' : `${Math.abs(delta)} ${Math.abs(delta) === 1 ? 'ponto' : 'pontos'} ${delta > 0 ? 'acima de' : 'abaixo de'}`} ${mesPorExtenso(a.competencia).split(' ')[0]}.`}{' '}
          Meta: {METAS.aprovadas}%.
        </>
      }
    />
  );
}

function CartaoNoPrazo({ med }: { med: ReturnType<typeof calcularMedicao> }) {
  const comDado = med.meses.filter((m) => m.pctNoPrazo !== null);
  const u = comDado[comDado.length - 1];
  if (!u) {
    return (
      <Cartao
        rotulo="Entrega no prazo"
        valor="Sem registro"
        apoio={`Começa a medir com as medições enviadas pelo portal; a planilha não tinha a data de envio. Meta: ${METAS.noPrazo}%.`}
      />
    );
  }
  return (
    <Cartao
      rotulo="Entrega no prazo"
      valor={porcento(u.pctNoPrazo!)}
      alerta={u.pctNoPrazo! < METAS.noPrazo}
      apoio={`${mesPorExtenso(u.competencia)}: ${u.noPrazo} de ${u.doPortal} até o dia 25${u.fechado ? '' : ' (mês ainda no prazo)'}. Meta: ${METAS.noPrazo}%.`}
    />
  );
}

type LinhaRanking = { chave: string; nome: string; valores: (string | number)[] };

function Ranking({ titulo, dica, colunas, piores, melhores }: { titulo: string; dica: ReactNode; colunas: string[]; piores: LinhaRanking[]; melhores: LinhaRanking[] }) {
  const [lado, setLado] = useState<'piores' | 'melhores'>('piores');
  const linhas = lado === 'piores' ? piores : melhores;
  return (
    <div className="ranking">
      <div className="barra-lista">
        <h3 className="detalhe-subtitulo">{titulo}</h3>
        <div className="chips" role="group" aria-label={`Ranking: ${titulo}`}>
          <button type="button" className="chip" aria-pressed={lado === 'piores'} onClick={() => setLado('piores')}>
            10 piores
          </button>
          <button type="button" className="chip" aria-pressed={lado === 'melhores'} onClick={() => setLado('melhores')}>
            10 melhores
          </button>
        </div>
      </div>
      <p className="dica">{dica}</p>
      <div className="tabela-rolagem">
        <table className="tabela tabela-compacta">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Empresa</th>
              {colunas.map((c) => (
                <th key={c} scope="col" className="num">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.length === 0 && (
              <tr>
                <td colSpan={2 + colunas.length} className="vazio-linha">
                  {lado === 'piores' ? 'Nenhuma empresa com problema neste filtro.' : 'Nenhuma empresa atende ao critério ainda.'}
                </td>
              </tr>
            )}
            {linhas.map((l, i) => (
              <tr key={l.chave}>
                <td className="num">{i + 1}</td>
                <th scope="row" className="ranking-empresa">{l.nome}</th>
                {l.valores.map((v, k) => (
                  <td key={k} className="num">{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
