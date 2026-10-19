import { useCallback, useEffect, useMemo, useState } from 'react';
import { mensagemDeErro } from './supabase';
import { lerAlocacoes, type AlocacaoResumo } from './admin';
import {
  lerMeusColaboradores, lerMinhasEmpresasComObras, lerMinhasPendencias, lerTipos,
  type MeuColaborador, type MinhaEmpresa, type PendenciaFornecedor, type TipoDocumento,
} from './fornecedor';

export type DadosFornecedor = {
  empresas: MinhaEmpresa[];
  tipos: Map<string, TipoDocumento>;
  colaboradores: MeuColaborador[];
  alocacoes: AlocacaoResumo[];
  pendencias: PendenciaFornecedor[];
};

// Carrega tudo o que as telas do fornecedor usam. As regras do banco já limitam às empresas do acesso.
export function useFornecedor() {
  const [dados, setDados] = useState<DadosFornecedor | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    try {
      const [empresas, tipos, colaboradores, alocacoes, pendencias] = await Promise.all([
        lerMinhasEmpresasComObras(),
        lerTipos(),
        lerMeusColaboradores(),
        lerAlocacoes(),
        lerMinhasPendencias(),
      ]);
      setDados({ empresas, tipos, colaboradores, alocacoes, pendencias });
      setErro(null);
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    }
  }, []);

  useEffect(() => {
    recarregar();
  }, [recarregar]);

  const indices = useMemo(() => {
    const empresaPorId = new Map((dados?.empresas ?? []).map((e) => [e.id, e]));
    const colaboradorPorId = new Map((dados?.colaboradores ?? []).map((c) => [c.id, c]));
    const alocacoesPorColaborador = new Map<string, AlocacaoResumo[]>();
    (dados?.alocacoes ?? []).forEach((a) => {
      alocacoesPorColaborador.set(a.colaborador_id, [...(alocacoesPorColaborador.get(a.colaborador_id) ?? []), a]);
    });
    const pendenciasPorAlocacao = new Map<string, PendenciaFornecedor[]>();
    (dados?.pendencias ?? []).forEach((p) => {
      pendenciasPorAlocacao.set(p.alocacao_id, [...(pendenciasPorAlocacao.get(p.alocacao_id) ?? []), p]);
    });
    return { empresaPorId, colaboradorPorId, alocacoesPorColaborador, pendenciasPorAlocacao };
  }, [dados]);

  return { dados, erro, setErro, recarregar, ...indices };
}

// Impeditivos que ainda travam o envio para análise.
export function travasDaAlocacao(pendencias: PendenciaFornecedor[] | undefined): PendenciaFornecedor[] {
  return (pendencias ?? []).filter((p) => p.impeditivo && ['nao_enviado', 'devolvido', 'vencido'].includes(p.situacao));
}

export function podeEnviarParaAnalise(a: AlocacaoResumo): boolean {
  return a.status === 'em_cadastro' || a.status === 'pendente_fornecedor';
}

// Um documento de colaborador aparece uma vez, mesmo que o colaborador esteja em mais de uma obra.
export function documentosDoColaborador(colaboradorId: string, pendencias: PendenciaFornecedor[]): PendenciaFornecedor[] {
  const porTipo = new Map<string, PendenciaFornecedor>();
  for (const p of pendencias) {
    if (p.colaborador_id !== colaboradorId || p.grupo !== 'colaborador') continue;
    if (!porTipo.has(p.tipo_codigo)) porTipo.set(p.tipo_codigo, p);
  }
  return [...porTipo.values()];
}
