import { supabase } from './supabase';
import { data } from './formato';

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

export async function lerCpfs(colaboradores: string[]): Promise<Map<string, string | null>> {
  const mapa = new Map<string, string | null>();
  for (let i = 0; i < colaboradores.length; i += 200) {
    const { data: linhas, error } = await supabase.from('colaboradores').select('id, cpf').in('id', colaboradores.slice(i, i + 200));
    if (error) throw error;
    (linhas ?? []).forEach((c) => mapa.set(c.id as string, (c.cpf as string | null) ?? null));
  }
  return mapa;
}

// Na folha que circula no canteiro, o CPF aparece só com o começo e o fim.
export function cpfParcial(cpf: string | null): string {
  if (!cpf || cpf.length !== 11) return '';
  return `${cpf.slice(0, 3)}.***.***-${cpf.slice(9)}`;
}

export type ParticipanteLista = { nome: string; cpf: string | null; empresa: string; funcao: string | null; presente?: boolean | null };

export async function baixarListaPresenca(i: Pick<Integracao, 'data' | 'horario' | 'local' | 'responsavel' | 'concluida_em'>, obra: string, participantes: ParticipanteLista[]) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const largura = doc.internal.pageSize.getWidth();
  const altura = doc.internal.pageSize.getHeight();
  const margem = 12;
  const petroleo: [number, number, number] = [0, 102, 102];
  const broto: [number, number, number] = [142, 217, 115];

  // Cabeçalho
  doc.setFillColor(...petroleo);
  doc.rect(0, 0, largura, 4, 'F');
  doc.setFillColor(...broto);
  doc.rect(0, 4, largura, 1.2, 'F');
  doc.setTextColor(28, 50, 50);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Lista de presença da integração de segurança', margem, 17);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(86, 107, 105);
  doc.text('Grupo Emais', largura - margem, 17, { align: 'right' });

  const campos: [string, string][] = [
    ['Obra', obra],
    ['Data', data(i.data)],
    ['Horário', i.horario ?? ''],
    ['Local', i.local ?? ''],
    ['Responsável', i.responsavel],
  ];
  let x = margem;
  const larguras = [78, 30, 30, 70, 69];
  campos.forEach(([rotulo, valor], k) => {
    doc.setFontSize(8);
    doc.setTextColor(86, 107, 105);
    doc.text(rotulo, x, 25);
    doc.setFontSize(11);
    doc.setTextColor(28, 50, 50);
    doc.setFont('helvetica', 'bold');
    doc.text(doc.splitTextToSize(valor || '______________', larguras[k] - 4)[0], x, 30.5);
    doc.setFont('helvetica', 'normal');
    x += larguras[k];
  });

  doc.setFontSize(9);
  doc.setTextColor(28, 50, 50);
  doc.text(
    'Ao assinar, declaro que participei da integração de segurança desta obra e recebi as orientações sobre os riscos do canteiro, o uso de EPI e as regras de acesso.',
    margem,
    38,
    { maxWidth: largura - margem * 2 },
  );

  const comPresenca = !!i.concluida_em;
  autoTable(doc, {
    startY: 43,
    margin: { left: margem, right: margem, bottom: 18, top: 20 },
    // Nas páginas seguintes, repete obra e data no topo para a folha não se perder do conjunto.
    didDrawPage: (d) => {
      if (d.pageNumber === 1) return;
      doc.setFillColor(...petroleo);
      doc.rect(0, 0, largura, 2.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(28, 50, 50);
      doc.text(`Lista de presença da integração: ${obra}, ${data(i.data)}${i.horario ? `, ${i.horario}` : ''}`, margem, 12);
      doc.setFont('helvetica', 'normal');
    },
    head: [['Nº', 'Nome', 'CPF', 'Empresa', 'Função', comPresenca ? 'Presença' : 'Assinatura']],
    body: participantes.map((p, n) => [
      String(n + 1),
      p.nome,
      cpfParcial(p.cpf),
      p.empresa,
      (p.funcao ?? '').toLowerCase(),
      comPresenca ? (p.presente ? 'Presente' : 'Ausente') : '',
    ]),
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: { top: 3.2, bottom: 3.2, left: 2, right: 2 }, textColor: [28, 50, 50], lineColor: [210, 220, 218], lineWidth: 0.2, valign: 'middle' },
    headStyles: { fillColor: petroleo, textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
    alternateRowStyles: { fillColor: [247, 250, 249] },
    columnStyles: {
      0: { cellWidth: 9, halign: 'right' },
      1: { cellWidth: 62, fontStyle: 'bold' },
      2: { cellWidth: 27 },
      3: { cellWidth: 62 },
      4: { cellWidth: 40 },
      5: { cellWidth: 'auto', minCellHeight: 11 },
    },
    rowPageBreak: 'avoid',
  });

  // Assinatura do responsável depois da tabela
  const fimTabela = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  let y = fimTabela + 18;
  if (y > altura - 24) {
    doc.addPage();
    y = 30;
  }
  doc.setDrawColor(28, 50, 50);
  doc.setLineWidth(0.3);
  doc.line(margem, y, margem + 95, y);
  doc.setFontSize(9);
  doc.text(`${i.responsavel}, responsável pela integração`, margem, y + 5);
  doc.line(largura - margem - 60, y, largura - margem, y);
  doc.text('Data', largura - margem - 60, y + 5);

  // Rodapé com página
  const paginas = doc.getNumberOfPages();
  const agora = new Date();
  const emitida = `${data(agora.toISOString())} ${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
  for (let p = 1; p <= paginas; p++) {
    doc.setPage(p);
    doc.setFontSize(7.5);
    doc.setTextColor(86, 107, 105);
    doc.text(`Portal de Terceiros, emitida em ${emitida}. ${participantes.length} participantes.`, margem, altura - 7);
    doc.text(`Página ${p} de ${paginas}`, largura - margem, altura - 7, { align: 'right' });
  }

  const nomeObra = obra.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-');
  doc.save(`lista-presenca-${nomeObra}-${i.data}.pdf`);
}
