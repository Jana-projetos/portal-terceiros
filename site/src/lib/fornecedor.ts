import { supabase } from './supabase';
import type { SituacaoPendencia } from './formato';

const TAMANHO_PAGINA = 1000;
export const TAMANHO_MAXIMO = 10 * 1024 * 1024;
export const TIPOS_ACEITOS = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic'];

async function lerTudo<T>(montar: (inicio: number, fim: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const todas: T[] = [];
  for (let inicio = 0; ; inicio += TAMANHO_PAGINA) {
    const { data, error } = await montar(inicio, inicio + TAMANHO_PAGINA - 1);
    if (error) throw error;
    todas.push(...(data ?? []));
    if (!data || data.length < TAMANHO_PAGINA) break;
  }
  return todas;
}

// ---------------------------------------------------------------- Cadastros de apoio

export type TipoDocumento = {
  codigo: string;
  nome: string;
  grupo: 'empresa' | 'colaborador' | 'obra';
  area: string;
  regra: 'emissao_mais_prazo' | 'vigencia_informada' | 'sem_vencimento';
  validade_dias: number | null;
  impeditivo: boolean;
  so_subcontratada: boolean;
  pode_dispensar: boolean;
  ordem: number;
};

export async function lerTipos(): Promise<Map<string, TipoDocumento>> {
  const { data, error } = await supabase
    .from('tipos_documento')
    .select('codigo, nome, grupo, area, regra, validade_dias, impeditivo, so_subcontratada, pode_dispensar, ordem')
    .eq('ativo', true)
    .eq('enviado_pelo_fornecedor', true)
    .order('ordem');
  if (error) throw error;
  return new Map((data ?? []).map((t) => [t.codigo, t as TipoDocumento]));
}

export type MinhaEmpresa = {
  id: string;
  razao_social: string;
  cnpj: string;
  obras: { id: string; nome: string; subcontratada: boolean }[];
};

export async function lerMinhasEmpresasComObras(): Promise<MinhaEmpresa[]> {
  const { data, error } = await supabase
    .from('empresas')
    .select('id, razao_social, cnpj, empresas_obras!empresas_obras_empresa_id_fkey(obra_id, subcontratada, ativo, obras(nome))')
    .order('razao_social');
  if (error) throw error;
  type Bruto = {
    id: string;
    razao_social: string;
    cnpj: string;
    empresas_obras: { obra_id: string; subcontratada: boolean; ativo: boolean; obras: { nome: string } | null }[];
  };
  return ((data ?? []) as unknown as Bruto[]).map((e) => ({
    id: e.id,
    razao_social: e.razao_social,
    cnpj: e.cnpj,
    obras: e.empresas_obras
      .filter((eo) => eo.ativo)
      .map((eo) => ({ id: eo.obra_id, nome: eo.obras?.nome ?? '', subcontratada: eo.subcontratada }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
  }));
}

export async function lerFuncoes(): Promise<{ id: string; nome: string }[]> {
  const { data, error } = await supabase.from('funcoes').select('id, nome').order('nome');
  if (error) throw error;
  return data ?? [];
}

// ---------------------------------------------------------------- Colaboradores

export type MeuColaborador = {
  id: string;
  empresa_id: string;
  nome: string;
  cpf: string | null;
  funcao_texto: string | null;
  situacao: 'ativo' | 'demitido' | 'desistente';
  pendencia_cadastro: string | null;
  funcoes: { nome: string } | null;
};

export async function lerMeusColaboradores(): Promise<MeuColaborador[]> {
  return lerTudo<MeuColaborador>((inicio, fim) =>
    supabase
      .from('colaboradores')
      .select('id, empresa_id, nome, cpf, funcao_texto, situacao, pendencia_cadastro, funcoes(nome)')
      .order('nome')
      .range(inicio, fim) as unknown as PromiseLike<{ data: MeuColaborador[] | null; error: unknown }>,
  );
}

export async function criarColaborador(dados: {
  empresa_id: string;
  nome: string;
  cpf: string;
  funcao_id: string | null;
  funcao_texto: string | null;
  obras: string[];
}): Promise<string> {
  const id = crypto.randomUUID();
  const { error } = await supabase.from('colaboradores').insert({
    id,
    empresa_id: dados.empresa_id,
    nome: dados.nome,
    cpf: dados.cpf,
    funcao_id: dados.funcao_id,
    funcao_texto: dados.funcao_texto,
  });
  if (error) {
    if ((error as { code?: string }).code === '23505') throw new Error('Este CPF já está cadastrado nesta empresa. Procure o colaborador na lista.');
    throw error;
  }
  for (const obra of dados.obras) await alocarEmObra(id, obra);
  return id;
}

export async function alocarEmObra(colaboradorId: string, obraId: string) {
  const { error } = await supabase.from('alocacoes').insert({ colaborador_id: colaboradorId, obra_id: obraId });
  if (error) {
    if ((error as { code?: string }).code === '23505') throw new Error('O colaborador já está nesta obra.');
    throw error;
  }
}

export async function informarDesligamento(colaboradorId: string, situacao: 'demitido' | 'desistente') {
  const { error } = await supabase.from('colaboradores').update({ situacao }).eq('id', colaboradorId);
  if (error) throw error;
}

export async function enviarParaAnalise(alocacaoId: string) {
  const { error } = await supabase.rpc('enviar_para_analise', { p_alocacao: alocacaoId });
  if (error) throw error;
}

// ---------------------------------------------------------------- Pendências

export type PendenciaFornecedor = {
  alocacao_id: string;
  obra_id: string;
  colaborador_id: string;
  empresa_id: string;
  tipo_codigo: string;
  documento: string;
  grupo: 'empresa' | 'colaborador' | 'obra';
  area: string;
  impeditivo: boolean;
  vencimento: string | null;
  dias_para_vencer: number | null;
  status_envio_aberto: string | null;
  motivo_devolucao: string | null;
  situacao: SituacaoPendencia;
};

export async function lerMinhasPendencias(): Promise<PendenciaFornecedor[]> {
  return lerTudo<PendenciaFornecedor>((inicio, fim) =>
    supabase
      .from('v_pendencias')
      .select('alocacao_id, obra_id, colaborador_id, empresa_id, tipo_codigo, documento, grupo, area, impeditivo, vencimento, dias_para_vencer, status_envio_aberto, motivo_devolucao, situacao')
      .order('alocacao_id')
      .order('tipo_codigo')
      .range(inicio, fim) as unknown as PromiseLike<{ data: PendenciaFornecedor[] | null; error: unknown }>,
  );
}

export function precisaAcao(situacao: SituacaoPendencia): boolean {
  return situacao === 'nao_enviado' || situacao === 'devolvido' || situacao === 'vencido' || situacao === 'a_vencer';
}

// ---------------------------------------------------------------- Documentos da empresa

export type DocumentoEmpresa = {
  tipo: TipoDocumento;
  situacao: SituacaoPendencia;
  vencimento: string | null;
  motivo_devolucao: string | null;
  renovacaoEmAnalise: boolean;
};

export async function lerDocumentosDaEmpresa(empresa: MinhaEmpresa, tipos: Map<string, TipoDocumento>): Promise<DocumentoEmpresa[]> {
  const [{ data: atuais, error: e1 }, { data: abertos, error: e2 }] = await Promise.all([
    supabase.from('v_documentos_atuais').select('tipo_codigo, vencimento, situacao').eq('empresa_id', empresa.id).is('colaborador_id', null),
    supabase.from('v_documentos_em_aberto').select('tipo_codigo, status, motivo_devolucao').eq('empresa_id', empresa.id).is('colaborador_id', null),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const subcontratada = empresa.obras.some((o) => o.subcontratada);
  return [...tipos.values()]
    .filter((t) => t.grupo === 'empresa' && (!t.so_subcontratada || subcontratada))
    .map((t) => {
      const atual = (atuais ?? []).find((a) => a.tipo_codigo === t.codigo);
      const aberto = (abertos ?? []).find((a) => a.tipo_codigo === t.codigo);
      let situacao: SituacaoPendencia;
      if (atual && atual.situacao !== 'vencido') situacao = atual.situacao as SituacaoPendencia;
      else if (aberto?.status === 'devolvido') situacao = 'devolvido';
      else if (aberto?.status === 'em_analise') situacao = 'em_analise';
      else if (!atual) situacao = 'nao_enviado';
      else situacao = 'vencido';
      return {
        tipo: t,
        situacao,
        vencimento: atual?.vencimento ?? null,
        motivo_devolucao: aberto?.status === 'devolvido' ? aberto.motivo_devolucao : null,
        renovacaoEmAnalise: aberto?.status === 'em_analise' && situacao !== 'em_analise',
      };
    });
}

// ---------------------------------------------------------------- Envio de documento

function tipoDoArquivo(arquivo: File): string {
  if (arquivo.type) return arquivo.type;
  const ext = arquivo.name.split('.').pop()?.toLowerCase();
  if (ext === 'heic' || ext === 'heif') return 'image/heic';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  return '';
}

export function problemaNoArquivo(arquivo: File): string | null {
  const tipo = tipoDoArquivo(arquivo);
  if (!TIPOS_ACEITOS.includes(tipo)) return `${arquivo.name}: envie PDF, JPG, PNG ou HEIC.`;
  if (arquivo.size > TAMANHO_MAXIMO) return `${arquivo.name}: o arquivo passa de 10 MB.`;
  if (arquivo.size === 0) return `${arquivo.name}: o arquivo está vazio.`;
  return null;
}

function nomeSeguro(nome: string): string {
  const semAcento = nome.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return semAcento.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').slice(-80) || 'arquivo';
}

export async function enviarDocumento(dados: {
  tipo: string;
  empresaId: string;
  colaboradorId: string | null;
  dataEmissao: string | null;
  vencimento: string | null;
  dispensado: boolean;
  motivoDispensa: string | null;
  arquivos: File[];
  aceiteLgpd: boolean;
  aoProgredir?: (feitos: number, total: number) => void;
}): Promise<string> {
  const id = crypto.randomUUID();
  const enviados: { caminho: string; nome: string; tamanho: number; tipo: string }[] = [];
  for (let i = 0; i < dados.arquivos.length; i++) {
    const arquivo = dados.arquivos[i];
    const caminho = `${dados.empresaId}/${id}/${i + 1}-${nomeSeguro(arquivo.name)}`;
    const tipo = tipoDoArquivo(arquivo);
    const { error } = await supabase.storage.from('documentos').upload(caminho, arquivo, { contentType: tipo, upsert: false });
    if (error) throw new Error(`Não foi possível enviar ${arquivo.name}. Confira a internet e tente de novo.`);
    enviados.push({ caminho, nome: arquivo.name, tamanho: arquivo.size, tipo });
    dados.aoProgredir?.(i + 1, dados.arquivos.length);
  }
  const { error } = await supabase.rpc('enviar_documento', {
    p_id: id,
    p_tipo: dados.tipo,
    p_empresa: dados.empresaId,
    p_colaborador: dados.colaboradorId,
    p_data_emissao: dados.dataEmissao,
    p_vencimento: dados.vencimento,
    p_dispensado: dados.dispensado,
    p_dados: dados.motivoDispensa ? { motivo_dispensa: dados.motivoDispensa } : {},
    p_arquivos: enviados,
    p_aceite_lgpd: dados.aceiteLgpd,
  });
  if (error) throw error;
  return id;
}
