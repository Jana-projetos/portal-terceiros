import type { StatusAlocacao } from './consultas';

// 'AAAA-MM-DD' ou data/hora ISO -> 'DD/MM/AAAA', sem mudar o dia por causa do fuso.
export function data(valor: string | null | undefined): string {
  if (!valor) return '';
  const [a, m, d] = valor.slice(0, 10).split('-');
  return d && m && a ? `${d}/${m}/${a}` : '';
}

export function hojeIso(): string {
  const h = new Date();
  const local = new Date(h.getTime() - h.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function somarDias(isoData: string, dias: number): string {
  const [a, m, d] = isoData.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d + dias));
  return dt.toISOString().slice(0, 10);
}

export function diasAte(isoData: string): number {
  const [a, m, d] = isoData.split('-').map(Number);
  const [ha, hm, hd] = hojeIso().split('-').map(Number);
  return Math.round((Date.UTC(a, m - 1, d) - Date.UTC(ha, hm - 1, hd)) / 86400000);
}

export function formatarCpf(cpf: string | null | undefined): string {
  if (!cpf) return '';
  return cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
}

export function soDigitos(v: string): string {
  return v.replace(/\D/g, '');
}

export function cpfValido(valor: string): boolean {
  const c = soDigitos(valor);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (base: string, peso: number) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (peso - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(c.slice(0, 9), 10) === Number(c[9]) && dv(c.slice(0, 10), 11) === Number(c[10]);
}

export function tamanhoArquivo(bytes: number | null | undefined): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

export const rotuloStatus: Record<StatusAlocacao, string> = {
  em_cadastro: 'Em cadastro',
  pendente_fornecedor: 'Com o fornecedor',
  em_analise: 'Em análise',
  aprovado_admin: 'Aguardando TST',
  liberado: 'Liberado',
  encerrado: 'Encerrado',
};

export type SituacaoPendencia =
  | 'nao_enviado'
  | 'em_analise'
  | 'devolvido'
  | 'vencido'
  | 'a_vencer'
  | 'vigente'
  | 'dispensado';

export const rotuloSituacao: Record<SituacaoPendencia, string> = {
  nao_enviado: 'Não enviado',
  em_analise: 'Em análise',
  devolvido: 'Devolvido',
  vencido: 'Vencido',
  a_vencer: 'Vence em breve',
  vigente: 'Em dia',
  dispensado: 'Dispensado',
};

// Ordem de exibição: o que trava primeiro.
export const ordemSituacao: Record<SituacaoPendencia, number> = {
  vencido: 0,
  nao_enviado: 1,
  devolvido: 2,
  em_analise: 3,
  a_vencer: 4,
  vigente: 5,
  dispensado: 6,
};
