import { supabase } from './supabase';

export type StatusAlocacao =
  | 'em_cadastro'
  | 'em_analise'
  | 'pendente_fornecedor'
  | 'aprovado_admin'
  | 'liberado'
  | 'encerrado';

export type LinhaAlocacao = {
  obra: string;
  status: StatusAlocacao;
  impeditivos_pendentes: number;
};

export type ResumoObra = {
  obra: string;
  ativos: number;
  liberados: number;
  liberadosComPendencia: number;
  comFornecedor: number;
  emAnalise: number;
  aguardandoTst: number;
};

const TAMANHO_PAGINA = 1000;

// Lê as alocações abertas que o usuário pode ver. As regras do banco já filtram:
// fornecedor vê as da própria empresa, TST as das suas obras, administrativo todas.
export async function lerAlocacoesAbertas(): Promise<LinhaAlocacao[]> {
  const linhas: LinhaAlocacao[] = [];
  for (let inicio = 0; ; inicio += TAMANHO_PAGINA) {
    const { data, error } = await supabase
      .from('v_alocacoes_resumo')
      .select('obra, status, impeditivos_pendentes')
      .neq('status', 'encerrado')
      .order('alocacao_id')
      .range(inicio, inicio + TAMANHO_PAGINA - 1);
    if (error) throw error;
    linhas.push(...((data ?? []) as LinhaAlocacao[]));
    if (!data || data.length < TAMANHO_PAGINA) break;
  }
  return linhas;
}

export function resumirPorObra(linhas: LinhaAlocacao[]): ResumoObra[] {
  const porObra = new Map<string, ResumoObra>();
  for (const l of linhas) {
    const r =
      porObra.get(l.obra) ??
      { obra: l.obra, ativos: 0, liberados: 0, liberadosComPendencia: 0, comFornecedor: 0, emAnalise: 0, aguardandoTst: 0 };
    r.ativos += 1;
    if (l.status === 'liberado') {
      r.liberados += 1;
      if (l.impeditivos_pendentes > 0) r.liberadosComPendencia += 1;
    } else if (l.status === 'pendente_fornecedor' || l.status === 'em_cadastro') r.comFornecedor += 1;
    else if (l.status === 'em_analise') r.emAnalise += 1;
    else if (l.status === 'aprovado_admin') r.aguardandoTst += 1;
    porObra.set(l.obra, r);
  }
  return [...porObra.values()].sort((a, b) => a.obra.localeCompare(b.obra, 'pt-BR'));
}

export async function lerMinhasEmpresas(): Promise<{ razao_social: string; cnpj: string }[]> {
  const { data, error } = await supabase.from('empresas').select('razao_social, cnpj').order('razao_social');
  if (error) throw error;
  return data ?? [];
}

export function formatarCnpj(cnpj: string): string {
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}
