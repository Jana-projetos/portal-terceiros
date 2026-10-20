import { supabase, enderecoDoSite } from './supabase';
import { data, hojeIso } from './formato';
import { lerAlocacoes, type AlocacaoResumo } from './admin';
import { lerTiposMedicao, lerTodasMedicoes, mesPorExtenso, type Medicao, type TipoMedicao } from './medicao';

// Calendário de cobrança (combinado com o administrativo):
// dia 20: lembrete da medição do mês anterior a quem ainda não enviou;
// dia 26: cobrança de quem não teve a medição aprovada e aviso de retenção para a engenharia de cada obra;
// documentos dos liberados: quando entram em 30 dias, em 15 dias e quando vencem.
// Cada e-mail é aberto no Outlook por uma pessoa, que confere e envia. Depois de aberto ou dispensado, sai da fila.

export const DIA_LEMBRETE = 20;
export const DIA_COBRANCA = 26;
// Antes disso a medição era controlada na planilha: só a partir daqui o portal sabe quem deveria ter enviado.
const INICIO_PORTAL = '2026-09-01';

export type TipoCobranca = 'lembrete_medicao' | 'cobranca_medicao' | 'retencao_obra' | 'vencimento_documento';

export type Registro = { tipo: TipoCobranca; referencia: string; empresa_id: string | null; obra_id: string | null; competencia: string | null };

export type Cobranca = {
  chave: string;
  tipo: TipoCobranca;
  titulo: string; // quem recebe (empresa ou obra)
  resumo: string;
  para: string;
  assunto: string;
  corpo: string;
  registros: Registro[];
  medicoes: string[]; // medições cobradas (para marcar a data da última cobrança)
  obraId: string | null; // retenção: obra cujos destinatários ficam guardados
};

export type Fila = { cobrancas: Cobranca[]; proxima: string };

// ---------------------------------------------------------------- Datas

function somarMeses(competencia: string, n: number): string {
  const [a, m] = competencia.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

function mesAtual(hoje: string): string {
  return `${hoje.slice(0, 7)}-01`;
}

function diaDoMes(hoje: string): number {
  return Number(hoje.slice(8, 10));
}

// Mês trabalhado do lembrete: entre os dias 20 e 25, o mês anterior.
export function competenciaDoLembrete(hoje = hojeIso()): string | null {
  const d = diaDoMes(hoje);
  return d >= DIA_LEMBRETE && d < DIA_COBRANCA ? somarMeses(mesAtual(hoje), -1) : null;
}

// Mês trabalhado da cobrança: o último com prazo vencido (a partir do dia 26, o mês anterior; antes, o retrasado).
export function competenciaDaCobranca(hoje = hojeIso()): string {
  return somarMeses(mesAtual(hoje), diaDoMes(hoje) >= DIA_COBRANCA ? -1 : -2);
}

export function proximaData(hoje = hojeIso()): string {
  const d = diaDoMes(hoje);
  const mes = mesAtual(hoje);
  if (d < DIA_LEMBRETE) return `${mes.slice(0, 8)}${DIA_LEMBRETE}`;
  if (d < DIA_COBRANCA) return `${mes.slice(0, 8)}${DIA_COBRANCA}`;
  return `${somarMeses(mes, 1).slice(0, 8)}${DIA_LEMBRETE}`;
}

// ---------------------------------------------------------------- Leitura

type Empresa = { id: string; razao_social: string; email_contato: string | null; email_acesso: string | null };
type Obra = { id: string; nome: string; emails_engenharia: string | null };
type ItemMed = { medicao_id: string; tipo_codigo: string; status: string };
type PendDoc = { alocacao_id: string; colaborador_id: string; empresa_id: string; tipo_codigo: string; documento: string; grupo: string; vencimento: string | null; dias_para_vencer: number | null; status_envio_aberto: string | null };

async function lerTudo<T>(montar: (inicio: number, fim: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const todas: T[] = [];
  for (let inicio = 0; ; inicio += 1000) {
    const { data: d, error } = await montar(inicio, inicio + 999);
    if (error) throw error;
    todas.push(...(d ?? []));
    if (!d || d.length < 1000) break;
  }
  return todas;
}

type Base = {
  medicoes: Medicao[];
  itens: ItemMed[];
  tipos: TipoMedicao[];
  alocacoes: AlocacaoResumo[];
  pendencias: PendDoc[];
  empresas: Empresa[];
  obras: Obra[];
  feitas: Set<string>;
};

async function lerBase(competencias: string[]): Promise<Base> {
  const [medicoes, tipos, alocacoes, pendencias, empresas, obras, feitas] = await Promise.all([
    lerTodasMedicoes(),
    lerTiposMedicao(),
    lerAlocacoes(),
    lerTudo<PendDoc>((i, f) =>
      supabase
        .from('v_pendencias')
        .select('alocacao_id, colaborador_id, empresa_id, tipo_codigo, documento, grupo, vencimento, dias_para_vencer, status_envio_aberto')
        .in('situacao', ['a_vencer', 'vencido'])
        .order('alocacao_id')
        .order('tipo_codigo')
        .range(i, f) as unknown as PromiseLike<{ data: PendDoc[] | null; error: unknown }>,
    ),
    lerTudo<Empresa>((i, f) => supabase.from('empresas').select('id, razao_social, email_contato, email_acesso').order('id').range(i, f) as unknown as PromiseLike<{ data: Empresa[] | null; error: unknown }>),
    lerTudo<Obra>((i, f) => supabase.from('obras').select('id, nome, emails_engenharia').order('id').range(i, f) as unknown as PromiseLike<{ data: Obra[] | null; error: unknown }>),
    lerTudo<{ tipo: string; referencia: string }>((i, f) =>
      supabase.from('cobrancas').select('tipo, referencia').order('id').range(i, f) as unknown as PromiseLike<{ data: { tipo: string; referencia: string }[] | null; error: unknown }>,
    ),
  ]);
  const ids = medicoes.filter((m) => competencias.includes(m.competencia) && m.status !== 'aprovada').map((m) => m.id);
  const itens: ItemMed[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data: d, error } = await supabase.from('medicoes_itens').select('medicao_id, tipo_codigo, status').in('medicao_id', ids.slice(i, i + 150));
    if (error) throw error;
    itens.push(...((d ?? []) as ItemMed[]));
  }
  return { medicoes, itens, tipos, alocacoes, pendencias, empresas, obras, feitas: new Set(feitas.map((c) => `${c.tipo}|${c.referencia}`)) };
}

// ---------------------------------------------------------------- Montagem dos e-mails

const LINK = () => `${enderecoDoSite}medicao`;

function assinatura(nome: string): string[] {
  return ['', 'Obrigado,', nome, 'Grupo Emais'];
}

function emailDaEmpresa(e: Empresa | undefined): string {
  return (e?.email_contato ?? e?.email_acesso ?? '').trim();
}

type Esperada = { empresa_id: string; empresa: string; obra_id: string | null; obra: string; medicao: Medicao | null };

// Quem deveria entregar a medição do mês: as que existem e as empresas com liberados na obra sem medição.
function esperadas(base: Base, competencia: string): Esperada[] {
  const doMes = base.medicoes.filter((m) => m.competencia === competencia);
  const lista: Esperada[] = doMes.map((m) => ({ empresa_id: m.empresa_id, empresa: m.empresa, obra_id: m.obra_id, obra: m.obra ?? 'controle anterior', medicao: m }));
  if (competencia >= INICIO_PORTAL) {
    const tem = new Set(doMes.map((m) => `${m.empresa_id}|${m.obra_id ?? ''}`));
    const vistos = new Set<string>();
    base.alocacoes
      .filter((a) => a.status === 'liberado')
      .forEach((a) => {
        const k = `${a.empresa_id}|${a.obra_id}`;
        if (tem.has(k) || vistos.has(k)) return;
        vistos.add(k);
        lista.push({ empresa_id: a.empresa_id, empresa: a.empresa, obra_id: a.obra_id, obra: a.obra, medicao: null });
      });
  }
  return lista;
}

function porEmpresa<T extends { empresa_id: string }>(l: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  l.forEach((x) => m.set(x.empresa_id, [...(m.get(x.empresa_id) ?? []), x]));
  return m;
}

function itensFaltando(base: Base, medicaoId: string): string[] {
  const tipoPor = new Map(base.tipos.map((t) => [t.codigo, t]));
  return base.itens
    .filter((i) => i.medicao_id === medicaoId && (i.status === 'nao_enviado' || i.status === 'devolvido'))
    .map((i) => tipoPor.get(i.tipo_codigo))
    .filter((t): t is TipoMedicao => !!t)
    .sort((a, b) => a.ordem - b.ordem)
    .map((t) => `${t.item}. ${t.nome}`);
}

function lembretes(base: Base, competencia: string, nome: string): Cobranca[] {
  const mes = mesPorExtenso(competencia);
  const prazo = `${somarMeses(competencia, 1).slice(0, 8)}25`;
  const faltam = esperadas(base, competencia).filter((x) => !x.medicao || x.medicao.status === 'aberta' || x.medicao.status === 'pendente_fornecedor');
  const empresaPor = new Map(base.empresas.map((e) => [e.id, e]));
  const lista: Cobranca[] = [];
  porEmpresa(faltam).forEach((l, empresaId) => {
    const referencia = `${competencia}:${empresaId}`;
    if (base.feitas.has(`lembrete_medicao|${referencia}`)) return;
    const empresa = l[0].empresa;
    const obras = l.map((x) => `- ${x.obra_id ? `Obra ${x.obra}` : 'Medição do mês'}: ${!x.medicao ? 'medição ainda não começou no portal' : x.medicao.status === 'pendente_fornecedor' ? 'devolvida pela Emais, falta corrigir e reenviar' : 'começada, falta enviar para conferência'}`);
    lista.push({
      chave: `lembrete|${referencia}`,
      tipo: 'lembrete_medicao',
      titulo: empresa,
      resumo: `${l.length} ${l.length === 1 ? 'obra' : 'obras'} sem envio`,
      para: emailDaEmpresa(empresaPor.get(empresaId)),
      assunto: `Lembrete: medição de ${mes} até ${data(prazo)}`,
      corpo: [
        'Olá,',
        '',
        `Lembrando que a medição de ${mes} da ${empresa} deve ser enviada pelo Portal de Terceiros até ${data(prazo)}:`,
        '',
        ...obras,
        '',
        'Sem a medição aprovada, o pagamento fica retido.',
        '',
        `Para enviar, entre no portal, em Medição: ${LINK()}`,
        ...assinatura(nome),
      ].join('\n'),
      registros: [{ tipo: 'lembrete_medicao', referencia, empresa_id: empresaId, obra_id: null, competencia }],
      medicoes: l.filter((x) => x.medicao).map((x) => x.medicao!.id),
      obraId: null,
    });
  });
  return lista;
}

function cobrancasDoMes(base: Base, competencia: string, nome: string): Cobranca[] {
  const mes = mesPorExtenso(competencia);
  const prazo = `${somarMeses(competencia, 1).slice(0, 8)}25`;
  const empresaPor = new Map(base.empresas.map((e) => [e.id, e]));
  // Não aprovadas e ainda não cobradas depois do prazo (o histórico da planilha já traz cobranças feitas).
  const retidas = esperadas(base, competencia).filter(
    (x) => !x.medicao || (x.medicao.status !== 'aprovada' && x.medicao.status !== 'em_analise' && !(x.medicao.ultima_cobranca_em && x.medicao.ultima_cobranca_em.slice(0, 10) > prazo)),
  );
  const lista: Cobranca[] = [];
  porEmpresa(retidas).forEach((l, empresaId) => {
    const referencia = `${competencia}:${empresaId}`;
    if (base.feitas.has(`cobranca_medicao|${referencia}`)) return;
    const empresa = l[0].empresa;
    const blocos = l.flatMap((x) => {
      // Histórico da planilha não tem obra: a linha sai sem o nome da obra.
      const onde = x.obra_id ? `Obra ${x.obra}` : 'Medição do mês';
      if (!x.medicao) return [`- ${onde}: não enviada`];
      const itens = itensFaltando(base, x.medicao.id);
      if (itens.length >= 12) return [`- ${onde}: não enviada`];
      if (itens.length === 0) {
        return [`- ${onde}: ${x.medicao.status === 'aberta' ? 'documentos enviados, falta clicar em "Enviar para conferência"' : 'falta corrigir os colaboradores com pendência e reenviar'}`];
      }
      return [`- ${onde}, falta:`, ...itens.map((i) => `    ${i}`)];
    });
    lista.push({
      chave: `cobranca|${referencia}`,
      tipo: 'cobranca_medicao',
      titulo: empresa,
      resumo: `${l.length} ${l.length === 1 ? 'obra' : 'obras'} com pagamento retido`,
      para: emailDaEmpresa(empresaPor.get(empresaId)),
      assunto: `Medição de ${mes} em atraso: pagamento retido`,
      corpo: [
        'Olá,',
        '',
        `O prazo da medição de ${mes} terminou em ${data(prazo)} e a da ${empresa} ainda não foi aprovada. O pagamento fica retido até a aprovação.`,
        '',
        ...blocos,
        '',
        `Envie o que falta pelo Portal de Terceiros, em Medição: ${LINK()}`,
        ...assinatura(nome),
      ].join('\n'),
      registros: [{ tipo: 'cobranca_medicao', referencia, empresa_id: empresaId, obra_id: null, competencia }],
      medicoes: l.filter((x) => x.medicao).map((x) => x.medicao!.id),
      obraId: null,
    });
  });
  return lista;
}

function retencoes(base: Base, competencia: string, nome: string): Cobranca[] {
  const mes = mesPorExtenso(competencia);
  const obraPor = new Map(base.obras.map((o) => [o.id, o]));
  const todas = esperadas(base, competencia).filter((x) => x.obra_id);
  const porObra = new Map<string, Esperada[]>();
  todas.forEach((x) => porObra.set(x.obra_id!, [...(porObra.get(x.obra_id!) ?? []), x]));
  const lista: Cobranca[] = [];
  porObra.forEach((l, obraId) => {
    const pendentes = l.filter((x) => !x.medicao || x.medicao.status !== 'aprovada');
    if (pendentes.length === 0) return;
    const referencia = `${competencia}:${obraId}`;
    if (base.feitas.has(`retencao_obra|${referencia}`)) return;
    const obra = obraPor.get(obraId);
    const nomeObra = obra?.nome ?? l[0].obra;
    const aprovadas = l.filter((x) => x.medicao?.status === 'aprovada');
    lista.push({
      chave: `retencao|${referencia}`,
      tipo: 'retencao_obra',
      titulo: nomeObra,
      resumo: `${pendentes.length} ${pendentes.length === 1 ? 'empresa retida' : 'empresas retidas'}`,
      para: obra?.emails_engenharia ?? '',
      assunto: `Medição de ${mes}, ${nomeObra}: pagamentos retidos`,
      corpo: [
        'Olá,',
        '',
        `Na obra ${nomeObra}, as empresas abaixo não têm a medição de ${mes} aprovada. O pagamento delas deve ficar retido até a aprovação:`,
        '',
        ...pendentes
          .sort((a, b) => a.empresa.localeCompare(b.empresa, 'pt-BR'))
          .map((x) => `- ${x.empresa}: ${!x.medicao ? 'medição não enviada' : x.medicao.status === 'em_analise' ? 'em conferência na Emais' : 'documentos pendentes'}`),
        '',
        ...(aprovadas.length > 0 ? [`Aprovadas e liberadas para pagamento: ${aprovadas.map((x) => x.empresa).join('; ')}.`, ''] : []),
        'Assim que alguma for aprovada, aviso.',
        ...assinatura(nome),
      ].join('\n'),
      registros: [{ tipo: 'retencao_obra', referencia, empresa_id: null, obra_id: obraId, competencia }],
      medicoes: [],
      obraId,
    });
  });
  return lista;
}

type Faixa = 'vencido' | '15' | '30';

function vencimentos(base: Base, nome: string): Cobranca[] {
  const liberadas = new Map(base.alocacoes.filter((a) => a.status === 'liberado').map((a) => [a.alocacao_id, a]));
  const empresaPor = new Map(base.empresas.map((e) => [e.id, e]));
  type Doc = { chave: string; faixa: Faixa; empresa_id: string; quem: string; documento: string; vencimento: string };
  const docs = new Map<string, Doc>();
  base.pendencias.forEach((p) => {
    const a = liberadas.get(p.alocacao_id);
    if (!a || !p.vencimento || p.dias_para_vencer === null || p.dias_para_vencer > 30) return;
    if (p.status_envio_aberto === 'em_analise') return; // renovação já enviada, esperando a análise
    const faixa: Faixa = p.dias_para_vencer <= 0 ? 'vencido' : p.dias_para_vencer <= 15 ? '15' : '30';
    const deQuem = p.grupo === 'empresa' ? 'empresa' : p.colaborador_id;
    const chave = `${faixa}:${p.empresa_id}:${p.tipo_codigo}:${deQuem}:${p.vencimento}`;
    if (base.feitas.has(`vencimento_documento|${chave}`) || docs.has(chave)) return;
    docs.set(chave, { chave, faixa, empresa_id: p.empresa_id, quem: p.grupo === 'empresa' ? 'Documento da empresa' : a.colaborador, documento: p.documento, vencimento: p.vencimento });
  });
  const lista: Cobranca[] = [];
  porEmpresa([...docs.values()]).forEach((l, empresaId) => {
    const e = empresaPor.get(empresaId);
    const empresa = e?.razao_social ?? '';
    const linha = (d: Doc) => `- ${d.quem}: ${d.documento}, ${d.faixa === 'vencido' ? 'venceu' : 'vence'} em ${data(d.vencimento)}`;
    const ordenar = (x: Doc[]) => x.sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.quem.localeCompare(b.quem, 'pt-BR'));
    const vencidos = ordenar(l.filter((d) => d.faixa === 'vencido'));
    const proximos = ordenar(l.filter((d) => d.faixa !== 'vencido'));
    lista.push({
      chave: `documentos|${empresaId}|${l.map((d) => d.chave).sort().join(',')}`,
      tipo: 'vencimento_documento',
      titulo: empresa,
      resumo: [vencidos.length ? `${vencidos.length} vencidos` : '', proximos.length ? `${proximos.length} vencendo` : ''].filter(Boolean).join(', '),
      para: emailDaEmpresa(e),
      assunto: vencidos.length ? `Documentos vencidos dos colaboradores: ${empresa}` : `Documentos vencendo nos próximos dias: ${empresa}`,
      corpo: [
        'Olá,',
        '',
        `Os documentos abaixo, de colaboradores da ${empresa} liberados nas obras da Emais, precisam ser renovados. Sem eles em dia, o colaborador fica irregular para trabalhar na obra.`,
        ...(vencidos.length ? ['', 'Já vencidos:', ...vencidos.map(linha)] : []),
        ...(proximos.length ? ['', 'Vencendo:', ...proximos.map(linha)] : []),
        '',
        `Envie os documentos atualizados pelo Portal de Terceiros, em O que falta: ${enderecoDoSite}pendencias`,
        ...assinatura(nome),
      ].join('\n'),
      registros: l.map((d) => ({ tipo: 'vencimento_documento' as const, referencia: d.chave, empresa_id: empresaId, obra_id: null, competencia: null })),
      medicoes: [],
      obraId: null,
    });
  });
  return lista;
}

export async function montarFila(nome: string): Promise<Fila> {
  const hoje = hojeIso();
  const lembrete = competenciaDoLembrete(hoje);
  const cobranca = competenciaDaCobranca(hoje);
  const base = await lerBase([lembrete, cobranca].filter((c): c is string => !!c));
  const ordem = (a: Cobranca, b: Cobranca) => a.titulo.localeCompare(b.titulo, 'pt-BR');
  return {
    cobrancas: [
      ...(lembrete ? lembretes(base, lembrete, nome).sort(ordem) : []),
      ...cobrancasDoMes(base, cobranca, nome).sort(ordem),
      ...retencoes(base, cobranca, nome).sort(ordem),
      ...vencimentos(base, nome).sort(ordem),
    ],
    proxima: proximaData(hoje),
  };
}

// ---------------------------------------------------------------- Registro

let cacheContagem: { valor: number; em: number } | null = null;

export async function contarCobrancas(nome: string): Promise<number> {
  if (cacheContagem && Date.now() - cacheContagem.em < 5 * 60000) return cacheContagem.valor;
  const fila = await montarFila(nome);
  cacheContagem = { valor: fila.cobrancas.length, em: Date.now() };
  return cacheContagem.valor;
}

export function esquecerContagem() {
  cacheContagem = null;
}

export async function registrarCobrancas(lista: Cobranca[], situacao: 'aberta_no_outlook' | 'dispensada', para?: Map<string, string>) {
  const linhas = lista.flatMap((c) =>
    c.registros.map((r) => ({ ...r, situacao, destinatarios: para?.get(c.chave) ?? c.para, assunto: c.assunto })),
  );
  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await supabase.from('cobrancas').upsert(linhas.slice(i, i + 500), { onConflict: 'tipo,referencia', ignoreDuplicates: true });
    if (error) throw error;
  }
  const medicoes = situacao === 'aberta_no_outlook' ? lista.flatMap((c) => c.medicoes) : [];
  if (medicoes.length > 0) {
    const { error } = await supabase.rpc('registrar_cobranca_medicao', { p_medicoes: medicoes });
    if (error) throw error;
  }
  esquecerContagem();
}

export async function guardarDestinatariosObra(obraId: string, emails: string) {
  const { error } = await supabase.from('obras').update({ emails_engenharia: emails.trim() || null }).eq('id', obraId);
  if (error) throw error;
}

export const titulosGrupo: Record<TipoCobranca, { titulo: string; apoio: string }> = {
  lembrete_medicao: { titulo: 'Lembrete da medição (dia 20)', apoio: 'Empresas que ainda não enviaram a medição do mês. O prazo é o dia 25.' },
  cobranca_medicao: { titulo: 'Cobrança da medição (dia 26)', apoio: 'Empresas com a medição do mês não aprovada depois do prazo. O pagamento fica retido.' },
  retencao_obra: { titulo: 'Aviso de retenção para as obras (dia 26)', apoio: 'Para a engenharia de cada obra, com as empresas que devem ficar com o pagamento retido.' },
  vencimento_documento: { titulo: 'Documentos vencendo', apoio: 'Colaboradores liberados com documento que vence em até 30 dias, em até 15 dias ou que já venceu. Cada documento entra uma vez por faixa.' },
};
