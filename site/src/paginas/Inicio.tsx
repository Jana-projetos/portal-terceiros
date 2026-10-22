import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSessao } from '../lib/sessao';
import { lerAlocacoesAbertas, resumirPorObra, type ResumoObra } from '../lib/consultas';
import { lerObrasDoPainel, lerPainelObra } from '../lib/painelObra';
import { contarCores, faroisDaObra, ordemCor, pior, rotuloCor, type Cor, type FarolEmpresa } from '../lib/farois';
import { Farol, LegendaFarois, LinhaFarol, ResumoFarois, SeloFrente } from '../componentes/Farois';
import { mensagemDeErro } from '../lib/supabase';
import { Topo } from '../componentes/Topo';
import { Carregando } from '../componentes/Carregando';
import { PainelObra } from './PainelObra';
import { MinhasObras } from './fornecedor/MinhasObras';

// Engenharia e TST entram direto no painel da obra com os faróis; o fornecedor, nas suas obras com os faróis;
// o administrativo vê todas as obras com os faróis.
export function Inicio() {
  const { usuario } = useSessao();
  if (usuario?.perfil === 'engenharia' || usuario?.perfil === 'tst') return <PainelObra />;
  if (usuario?.perfil === 'fornecedor') return <MinhasObras />;
  return <InicioPadrao />;
}

type Obra = {
  id: string;
  nome: string;
  geral: Cor;
  doc: Cor;
  int: Cor;
  med: Cor;
  farois: FarolEmpresa[];
  contagem: Record<Cor, number>;
  numeros: ResumoObra | null;
};

// Situação das obras (administrativo): uma linha por obra com os faróis; ao clicar, as empresas da obra.
function InicioPadrao() {
  const [obras, setObras] = useState<Obra[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const [lista, alocacoes] = await Promise.all([lerObrasDoPainel(), lerAlocacoesAbertas()]);
      const numeros = new Map(resumirPorObra(alocacoes).map((r) => [r.obraId, r]));
      const paineis = await Promise.all(lista.map(async (o) => ({ obra: o, painel: await lerPainelObra(o.id) })));
      const montadas = paineis
        .map(({ obra, painel }): Obra => {
          const farois = faroisDaObra(painel.colaboradores, painel.medicoes);
          return {
            id: obra.id,
            nome: obra.nome,
            geral: pior(...farois.map((f) => f.geral)),
            doc: pior(...farois.map((f) => f.doc.cor)),
            int: pior(...farois.map((f) => f.int.cor)),
            med: pior(...farois.map((f) => f.med.cor)),
            farois,
            contagem: contarCores(farois),
            numeros: numeros.get(obra.id) ?? null,
          };
        })
        .filter((o) => o.farois.length > 0 || o.numeros)
        .sort((a, b) => ordemCor[a.geral] - ordemCor[b.geral] || a.nome.localeCompare(b.nome, 'pt-BR'));
      if (cancelado) return;
      setObras(montadas);
    })().catch((e) => !cancelado && setErro(mensagemDeErro(e)));
    return () => {
      cancelado = true;
    };
  }, []);

  const empresas = useMemo(() => (obras ?? []).flatMap((o) => o.farois), [obras]);

  return (
    <div className="pagina">
      <Topo />
      <main className="conteudo">
        <section className="cabecalho">
          <h1>Situação das obras</h1>
          <p className="apoio">Cada obra com os faróis de documentos, integração e medição das empresas que trabalham nela. Os números do topo contam as empresas em cada obra. Clique na obra para ver as empresas.</p>
        </section>

        {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
        {!erro && !obras && <Carregando />}
        {obras && obras.length === 0 && <p className="vazio">Nenhuma alocação aberta no momento.</p>}

        {obras && obras.length > 0 && (
          <>
            <ResumoFarois contagem={contarCores(empresas)} />
            <LegendaFarois />
            <ul className="lista-farois">
              {obras.map((o) => (
                <LinhaFarol
                  key={o.id}
                  id={o.id}
                  geral={o.geral}
                  titulo={o.nome}
                  subtitulo={o.numeros ? numerosDaObra(o.numeros) : undefined}
                  manchete={mancheteDaObra(o)}
                  doc={o.doc}
                  int={o.int}
                  med={o.med}
                  aberta={aberta === o.id}
                  aoAlternar={() => setAberta(aberta === o.id ? null : o.id)}
                >
                  {o.farois.length === 0 ? (
                    <p className="frente">Nenhuma empresa com colaborador ou medição nesta obra.</p>
                  ) : (
                    <ul className="empresas-obra">
                      {o.farois.map((f) => (
                        <li key={f.empresaId} className="empresa-obra">
                          <span className="tarefa-texto">
                            <Farol cor={f.geral} rotulo={rotuloCor[f.geral]} />
                            <span>
                              <strong>{f.empresa}</strong>
                              {f.manchete}
                            </span>
                          </span>
                          <span className="linha-farol-frentes">
                            <SeloFrente nome="Documentos" cor={f.doc.cor} />
                            <SeloFrente nome="Integração" cor={f.int.cor} />
                            <SeloFrente nome="Medição" cor={f.med.cor} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="linha-botoes">
                    <Link className="botao botao-pequeno" to={`/painel-obra?obra=${o.id}`}>Abrir o painel da obra</Link>
                    <Link className="botao botao-secundario botao-pequeno" to={`/colaboradores?obra=${o.id}`}>Ver colaboradores</Link>
                  </p>
                </LinhaFarol>
              ))}
            </ul>
            <p className="dica">Bloqueios primeiro, depois pendências, depois as obras em dia. O farol da obra é o pior entre as empresas dela.</p>
          </>
        )}
      </main>
    </div>
  );
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

function numerosDaObra(r: ResumoObra): string {
  const partes = [plural(r.ativos, 'ativo', 'ativos'), plural(r.liberados, 'liberado', 'liberados')];
  const emAnalise = r.emAnalise + r.aguardandoTst;
  if (emAnalise) partes.push(`${emAnalise} em análise`);
  if (r.comFornecedor) partes.push(`${r.comFornecedor} com o fornecedor`);
  return partes.join(' · ');
}

function mancheteDaObra(o: Obra): string {
  const c = o.contagem;
  const partes: string[] = [];
  if (c.vermelho) partes.push(`${plural(c.vermelho, 'empresa', 'empresas')} com bloqueio`);
  if (c.amarelo) partes.push(`${plural(c.amarelo, 'empresa', 'empresas')} com pendência`);
  if (c.verde) partes.push(`${plural(c.verde, 'empresa', 'empresas')} em dia`);
  return partes.length ? partes.join(', ') : 'Nenhuma empresa na obra';
}
