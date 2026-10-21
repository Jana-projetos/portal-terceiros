import { supabase } from './supabase';
import { gerarListaPresenca, type ModeloLista } from './listaPresenca';

export type Integracao = {
  id: string;
  obra_id: string;
  data: string;
  horario: string | null;
  local: string | null;
  responsavel: string;
  criado_em: string;
  concluida_em: string | null;
  cancelada_em: string | null;
  integracoes_participantes: { alocacao_id: string; presente: boolean | null }[];
};

export async function lerIntegracoes(obraId: string): Promise<Integracao[]> {
  const { data: linhas, error } = await supabase
    .from('integracoes')
    .select('id, obra_id, data, horario, local, responsavel, criado_em, concluida_em, cancelada_em, integracoes_participantes(alocacao_id, presente)')
    .eq('obra_id', obraId)
    .is('cancelada_em', null)
    .order('data', { ascending: false })
    .limit(60);
  if (error) throw error;
  return (linhas ?? []) as Integracao[];
}

export async function criarIntegracao(dados: {
  obraId: string;
  data: string;
  horario: string;
  local: string;
  responsavel: string;
  alocacoes: string[];
}): Promise<Integracao> {
  const { data: i, error } = await supabase.rpc('criar_integracao', {
    p_obra: dados.obraId,
    p_data: dados.data,
    p_horario: dados.horario,
    p_local: dados.local,
    p_responsavel: dados.responsavel,
    p_alocacoes: dados.alocacoes,
  });
  if (error) throw error;
  return { ...(i as Omit<Integracao, 'integracoes_participantes'>), integracoes_participantes: dados.alocacoes.map((alocacao_id) => ({ alocacao_id, presente: null })) };
}

export async function concluirIntegracao(id: string, presentes: string[]): Promise<number> {
  const { data: qtd, error } = await supabase.rpc('concluir_integracao', { p_integracao: id, p_presentes: presentes });
  if (error) throw error;
  return qtd as number;
}

export async function cancelarIntegracao(id: string) {
  const { error } = await supabase.rpc('cancelar_integracao', { p_integracao: id });
  if (error) throw error;
}

export type ParticipanteLista = { nome: string; empresa: string; funcao: string | null; presente?: boolean | null };

// Documento controlado "Declaração de recebimento de treinamento": texto, revisão e data vêm do banco.
export async function lerModeloLista(): Promise<ModeloLista> {
  const { data: m, error } = await supabase
    .from('modelos_documento')
    .select('titulo, setor, data_revisao, revisao, conteudo')
    .eq('codigo', 'lista_presenca_integracao')
    .single();
  if (error) throw new Error('Não foi possível carregar o modelo da lista de presença. Tente de novo.');
  return m as ModeloLista;
}

async function lerLogo(): Promise<string | null> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}logo-emais.png`);
    if (!r.ok) return null;
    const blob = await r.blob();
    return await new Promise((ok) => {
      const leitor = new FileReader();
      leitor.onload = () => ok(leitor.result as string);
      leitor.onerror = () => ok(null);
      leitor.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// Uma folha por empresa (o documento tem o campo EMPRESA). Depois da integração concluída, só os presentes.
export async function baixarListaPresenca(i: Pick<Integracao, 'data' | 'responsavel' | 'concluida_em'>, obra: string, participantes: ParticipanteLista[]) {
  const [{ jsPDF }, modelo, logo] = await Promise.all([import('jspdf'), lerModeloLista(), lerLogo()]);
  const lista = i.concluida_em ? participantes.filter((p) => p.presente) : participantes;
  const porEmpresa = new Map<string, ParticipanteLista[]>();
  lista.forEach((p) => porEmpresa.set(p.empresa, [...(porEmpresa.get(p.empresa) ?? []), p]));
  const empresas = [...porEmpresa.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
    .map(([empresa, ps]) => ({ empresa, participantes: ps.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map((p) => ({ nome: p.nome, funcao: p.funcao })) }));
  if (empresas.length === 0) throw new Error('A turma não tem participantes para a lista.');
  const doc = gerarListaPresenca(jsPDF, modelo, logo, { obra, data: i.data, instrutor: i.responsavel, empresas });
  const nomeObra = obra.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, ' ').trim();
  doc.save(`${i.data.replace(/-/g, '')}_Lista de presenca integracao_${nomeObra}.pdf`);
}
