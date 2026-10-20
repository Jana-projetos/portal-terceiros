import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Carregando } from '../../componentes/Carregando';
import { mensagemDeErro } from '../../lib/supabase';
import { formatarCnpj } from '../../lib/consultas';
import { lerTodasMedicoes, mesCurto, rotuloStatusMedicao, type Medicao } from '../../lib/medicao';

export function AbasMedicao({ atual }: { atual: 'mes' | 'historico' }) {
  return (
    <nav className="abas" aria-label="Visões da medição">
      <Link to="/medicao" aria-current={atual === 'mes' ? 'page' : undefined}>Por mês</Link>
      <Link to="/medicao?ver=historico" aria-current={atual === 'historico' ? 'page' : undefined}>Histórico por empresa</Link>
    </nav>
  );
}

type Estado = 'aprovada' | 'em_analise' | 'pendente' | 'retida';

function estadoDe(m: Medicao): Estado {
  if (m.status === 'aprovada') return 'aprovada';
  if (m.status === 'em_analise') return 'em_analise';
  return m.retida ? 'retida' : 'pendente';
}

const ROTULO: Record<Estado, string> = { aprovada: 'OK', em_analise: 'Conferir', pendente: 'Pendente', retida: 'Retida' };
const LEGENDA: Record<Estado, string> = {
  aprovada: 'Aprovada',
  em_analise: 'Enviada, aguardando conferência',
  pendente: 'Com pendência, dentro do prazo ou da tolerância (dia 30)',
  retida: 'Retida: não aprovada depois do dia 30 ou da data combinada',
};

type Linha = { empresa_id: string; empresa: string; cnpj: string; porMes: Map<string, Medicao[]>; total: number; aprovadas: number; retidas: number };

export function HistoricoMedicao() {
  const [medicoes, setMedicoes] = useState<Medicao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [obra, setObra] = useState('');
  const [soPendencia, setSoPendencia] = useState(false);
  const [ordem, setOrdem] = useState<'nome' | 'retidas'>('nome');

  useEffect(() => {
    lerTodasMedicoes()
      .then(setMedicoes)
      .catch((e) => setErro(mensagemDeErro(e)));
  }, []);

  const obras = useMemo(() => {
    const m = new Map<string, string>();
    (medicoes ?? []).forEach((x) => x.obra_id && x.obra && m.set(x.obra_id, x.obra));
    return [...m.entries()].sort(([, a], [, b]) => a.localeCompare(b, 'pt-BR'));
  }, [medicoes]);

  const meses = useMemo(() => [...new Set((medicoes ?? []).map((m) => m.competencia))].sort(), [medicoes]);

  const linhas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const porEmpresa = new Map<string, Linha>();
    (medicoes ?? [])
      .filter((m) => !obra || m.obra_id === obra)
      .forEach((m) => {
        const l = porEmpresa.get(m.empresa_id) ?? { empresa_id: m.empresa_id, empresa: m.empresa, cnpj: m.cnpj, porMes: new Map(), total: 0, aprovadas: 0, retidas: 0 };
        l.porMes.set(m.competencia, [...(l.porMes.get(m.competencia) ?? []), m]);
        l.total += 1;
        if (m.status === 'aprovada') l.aprovadas += 1;
        if (m.retida) l.retidas += 1;
        porEmpresa.set(m.empresa_id, l);
      });
    return [...porEmpresa.values()]
      .filter((l) => !t || l.empresa.toLowerCase().includes(t) || l.cnpj.includes(t.replace(/\D/g, '') || '§'))
      .filter((l) => !soPendencia || l.aprovadas < l.total)
      .sort((a, b) => (ordem === 'retidas' ? b.retidas - a.retidas : 0) || a.empresa.localeCompare(b.empresa, 'pt-BR'));
  }, [medicoes, busca, obra, soPendencia, ordem]);

  const totaisMes = meses.map((c) => {
    const l = linhas.flatMap((x) => x.porMes.get(c) ?? []);
    return { c, total: l.length, aprovadas: l.filter((m) => m.status === 'aprovada').length };
  });

  return (
    <Pagina
      titulo="Medição mensal"
      apoio="Situação de cada empresa mês a mês, como na planilha de controle. Clique numa célula para abrir a medição."
    >
      <AbasMedicao atual="historico" />
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {!medicoes && !erro && <Carregando />}

      {medicoes && (
        <>
          <div className="filtros">
            <label className="campo campo-busca">
              <span>Buscar</span>
              <input type="search" placeholder="Empresa ou CNPJ" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </label>
            <label className="campo">
              <span>Obra</span>
              <select value={obra} onChange={(e) => setObra(e.target.value)}>
                <option value="">Todas, com o histórico da planilha</option>
                {obras.map(([id, nome]) => (
                  <option key={id} value={id}>{nome}</option>
                ))}
              </select>
            </label>
            <label className="campo">
              <span>Ordem</span>
              <select value={ordem} onChange={(e) => setOrdem(e.target.value as 'nome' | 'retidas')}>
                <option value="nome">Nome da empresa</option>
                <option value="retidas">Mais meses retidos primeiro</option>
              </select>
            </label>
            <label className="opcao opcao-filtro">
              <input type="checkbox" checked={soPendencia} onChange={(e) => setSoPendencia(e.target.checked)} />
              <span>Só empresas com algum mês não aprovado</span>
            </label>
          </div>

          <ul className="legenda">
            {(Object.keys(LEGENDA) as Estado[]).map((e) => (
              <li key={e}>
                <span className={`celula celula-${e}`}>{ROTULO[e]}</span> {LEGENDA[e]}
              </li>
            ))}
            <li>
              <span className="celula celula-vazia" /> Sem medição no mês
            </li>
          </ul>

          <p className="dica">
            {linhas.length} {linhas.length === 1 ? 'empresa' : 'empresas'}. Quando a empresa tem mais de uma obra no mês, cada obra aparece numa linha da célula; passe o mouse para ver qual.
          </p>

          <div className="tabela-rolagem">
            <table className="tabela tabela-compacta tabela-historico">
              <thead>
                <tr>
                  <th scope="col">Empresa</th>
                  {meses.map((c) => (
                    <th key={c} scope="col">{mesCurto(c)}</th>
                  ))}
                  <th scope="col" className="num">Aprovadas</th>
                </tr>
              </thead>
              <tbody>
                {linhas.length === 0 && (
                  <tr>
                    <td colSpan={meses.length + 2} className="vazio-linha">Nenhuma empresa no filtro.</td>
                  </tr>
                )}
                {linhas.map((l) => (
                  <tr key={l.empresa_id}>
                    <th scope="row">
                      {l.empresa}
                      <small className="sub">{formatarCnpj(l.cnpj)}</small>
                    </th>
                    {meses.map((c) => {
                      const doMes = (l.porMes.get(c) ?? []).sort((a, b) => (a.obra ?? '').localeCompare(b.obra ?? '', 'pt-BR'));
                      return (
                        <td key={c}>
                          {doMes.length === 0 ? (
                            <span className="celula celula-vazia" aria-label="Sem medição" />
                          ) : (
                            <span className="celulas">
                              {doMes.map((m) => {
                                const e = estadoDe(m);
                                const descricao = `${m.obra ?? 'Planilha, sem obra'}: ${rotuloStatusMedicao[m.status]}${m.retida ? ', retida' : ''}${m.status !== 'aprovada' && m.itens_pendentes ? `, ${m.itens_pendentes} itens pendentes` : ''}`;
                                return (
                                  <Link key={m.id} className={`celula celula-${e}`} to={`/medicao?m=${m.id}&mes=${c}&de=historico`} title={descricao} aria-label={`${mesCurto(c)}, ${descricao}`}>
                                    {ROTULO[e]}
                                  </Link>
                                );
                              })}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="num">
                      {l.aprovadas} de {l.total}
                    </td>
                  </tr>
                ))}
              </tbody>
              {linhas.length > 0 && (
                <tfoot>
                  <tr>
                    <th scope="row">Aprovadas no mês</th>
                    {totaisMes.map((t) => (
                      <td key={t.c}>
                        {t.total ? `${Math.round((100 * t.aprovadas) / t.total)}%` : ''}
                        {t.total > 0 && <small className="sub">{t.aprovadas} de {t.total}</small>}
                      </td>
                    ))}
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}
    </Pagina>
  );
}
