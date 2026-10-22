import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSessao, type Perfil } from '../lib/sessao';
import { lerAlocacoesAbertas, lerMinhasEmpresas, resumirPorObra, formatarCnpj, type ResumoObra } from '../lib/consultas';
import { mensagemDeErro } from '../lib/supabase';
import { Topo } from '../componentes/Topo';
import { Carregando } from '../componentes/Carregando';
import { PainelObra } from './PainelObra';
import { MinhasObras } from './fornecedor/MinhasObras';

const titulos: Record<Exclude<Perfil, 'engenharia'>, { titulo: string; apoio: string; vazio: string }> = {
  admin: {
    titulo: 'Situação das obras',
    apoio: 'Colaboradores alocados em cada obra, sem contar os desligados.',
    vazio: 'Nenhuma alocação aberta no momento.',
  },
  tst: {
    titulo: 'Suas obras',
    apoio: 'Colaboradores alocados nas obras sob sua responsabilidade.',
    vazio: 'Nenhuma obra está ligada ao seu acesso. Peça ao administrativo da Emais para vincular suas obras.',
  },
  fornecedor: {
    titulo: 'Seus colaboradores nas obras',
    apoio: 'Situação de liberação dos colaboradores da sua empresa em cada obra da Emais.',
    vazio: 'Sua empresa ainda não tem colaboradores alocados em obras.',
  },
};

// Engenharia e TST entram direto no painel da obra com os faróis; o fornecedor, nas suas obras com os faróis;
// o administrativo continua com o resumo de todas as obras.
export function Inicio() {
  const { usuario } = useSessao();
  if (usuario?.perfil === 'engenharia' || usuario?.perfil === 'tst') return <PainelObra />;
  if (usuario?.perfil === 'fornecedor') return <MinhasObras />;
  return <InicioPadrao />;
}

function InicioPadrao() {
  const { usuario } = useSessao();
  const [resumo, setResumo] = useState<ResumoObra[] | null>(null);
  const [empresas, setEmpresas] = useState<{ razao_social: string; cnpj: string }[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    Promise.all([lerAlocacoesAbertas(), usuario?.perfil === 'fornecedor' ? lerMinhasEmpresas() : Promise.resolve([])])
      .then(([linhas, emps]) => {
        if (cancelado) return;
        setResumo(resumirPorObra(linhas));
        setEmpresas(emps);
      })
      .catch((e) => !cancelado && setErro(mensagemDeErro(e)));
    return () => {
      cancelado = true;
    };
  }, [usuario?.perfil]);

  if (!usuario || usuario.perfil === 'engenharia') return null;
  const textos = titulos[usuario.perfil];
  const total = resumo && somar(resumo);

  return (
    <div className="pagina">
      <Topo />
      <main className="conteudo">
        <section className="cabecalho">
          <h1>{textos.titulo}</h1>
          <p className="apoio">{textos.apoio}</p>
          {empresas.length > 0 && (
            <ul className="empresas">
              {empresas.map((e) => (
                <li key={e.cnpj}>
                  {e.razao_social} <span className="cnpj">{formatarCnpj(e.cnpj)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
        {!erro && !resumo && <Carregando />}
        {resumo && resumo.length === 0 && <p className="vazio">{textos.vazio}</p>}

        {resumo && resumo.length > 0 && total && (
          <>
            <ul className="legenda" aria-label="Legenda das barras">
              <li><i className="cor-liberado" />Liberados</li>
              <li><i className="cor-pendencia" />Liberados com documento vencido ou faltando</li>
              <li><i className="cor-analise" />Em análise na Emais</li>
              <li><i className="cor-fornecedor" />Com pendência para o fornecedor</li>
            </ul>

            <div className="tabela-rolagem">
              <table className="tabela">
                <thead>
                  <tr>
                    <th scope="col">Obra</th>
                    <th scope="col" className="num">Ativos</th>
                    <th scope="col" className="num">Liberados</th>
                    <th scope="col" className="num">Liberados com pendência</th>
                    <th scope="col" className="num">Em análise</th>
                    <th scope="col" className="num">Com o fornecedor</th>
                    <th scope="col" className="col-barra"><span className="sr">Proporção</span></th>
                  </tr>
                </thead>
                <tbody>
                  {resumo.map((r) => (
                    <Linha key={r.obra} r={r} comLink={usuario.perfil === 'admin' || usuario.perfil === 'tst'} />
                  ))}
                </tbody>
                {resumo.length > 1 && (
                  <tfoot>
                    <Linha r={total} />
                  </tfoot>
                )}
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function Linha({ r, comLink = false }: { r: ResumoObra; comLink?: boolean }) {
  const emAnalise = r.emAnalise + r.aguardandoTst;
  const semPendencia = r.liberados - r.liberadosComPendencia;
  const pct = (n: number) => `${r.ativos ? (n / r.ativos) * 100 : 0}%`;
  return (
    <tr>
      <th scope="row">{comLink && r.obraId ? <Link className="link" to={`/colaboradores?obra=${r.obraId}`}>{r.obra}</Link> : r.obra}</th>
      <td className="num" data-rotulo="Ativos">{r.ativos}</td>
      <td className="num" data-rotulo="Liberados">{r.liberados}</td>
      <td className="num" data-rotulo="Liberados com pendência">{r.liberadosComPendencia || <span className="zero">0</span>}</td>
      <td className="num" data-rotulo="Em análise">{emAnalise || <span className="zero">0</span>}</td>
      <td className="num" data-rotulo="Com o fornecedor">{r.comFornecedor || <span className="zero">0</span>}</td>
      <td className="col-barra">
        <div
          className="barra"
          role="img"
          aria-label={`${semPendencia} liberados sem pendência, ${r.liberadosComPendencia} liberados com pendência, ${emAnalise} em análise e ${r.comFornecedor} com o fornecedor`}
        >
          <span className="cor-liberado" style={{ width: pct(semPendencia) }} />
          <span className="cor-pendencia" style={{ width: pct(r.liberadosComPendencia) }} />
          <span className="cor-analise" style={{ width: pct(emAnalise) }} />
          <span className="cor-fornecedor" style={{ width: pct(r.comFornecedor) }} />
        </div>
      </td>
    </tr>
  );
}

function somar(lista: ResumoObra[]): ResumoObra {
  return lista.reduce(
    (t, r) => ({
      obraId: null,
      obra: 'Total',
      ativos: t.ativos + r.ativos,
      liberados: t.liberados + r.liberados,
      liberadosComPendencia: t.liberadosComPendencia + r.liberadosComPendencia,
      comFornecedor: t.comFornecedor + r.comFornecedor,
      emAnalise: t.emAnalise + r.emAnalise,
      aguardandoTst: t.aguardandoTst + r.aguardandoTst,
    }),
    { obraId: null, obra: 'Total', ativos: 0, liberados: 0, liberadosComPendencia: 0, comFornecedor: 0, emAnalise: 0, aguardandoTst: 0 },
  );
}
