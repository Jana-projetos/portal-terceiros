import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Dialogo } from './Dialogo';
import { TermoLgpd } from './TermoLgpd';
import { mensagemDeErro } from '../lib/supabase';
import { tamanhoArquivo } from '../lib/formato';
import { enviarItemMedicao, marcarNaoSeAplica, mesPorExtenso, problemaNoArquivo, type ItemMedicao, type Medicao, type TipoMedicao } from '../lib/medicao';

export type PedidoMedicao = { medicao: Medicao; item: ItemMedicao; tipo: TipoMedicao; modo: 'arquivo' | 'nao_aplica' };

const MAXIMO_ARQUIVOS = 10;

export function EnvioMedicao({ pedido, aoFechar, aoEnviar }: { pedido: PedidoMedicao | null; aoFechar: () => void; aoEnviar: (texto: string) => void }) {
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [justificativa, setJustificativa] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [progresso, setProgresso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aceite, setAceite] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setArquivos([]);
    setJustificativa('');
    setErro(null);
    setProgresso(null);
    setAceite(false);
  }, [pedido]);

  if (!pedido) return <Dialogo aberto={false} titulo="" aoFechar={aoFechar}>{null}</Dialogo>;
  const { medicao, item, tipo, modo } = pedido;

  const problemas = arquivos.map(problemaNoArquivo).filter((p): p is string => !!p);
  // O aceite de LGPD vale para envio de arquivo; "não se aplica" não envia dado pessoal.
  const pronto = modo === 'nao_aplica' ? justificativa.trim().length >= 3 : arquivos.length > 0 && problemas.length === 0 && aceite;

  function adicionar(lista: FileList | null) {
    if (!lista) return;
    const novos = Array.from(lista);
    setArquivos((atuais) => [...atuais, ...novos].slice(0, MAXIMO_ARQUIVOS));
    if (entrada.current) entrada.current.value = '';
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!pronto || !pedido) return;
    setErro(null);
    setEnviando(true);
    try {
      if (modo === 'nao_aplica') {
        await marcarNaoSeAplica(medicao.id, tipo.codigo, justificativa.trim());
        aoEnviar(`${tipo.nome}: marcado como não se aplica.`);
      } else {
        await enviarItemMedicao({ medicao, item, arquivos, aceiteLgpd: aceite, aoProgredir: (f, t) => setProgresso(`Enviando arquivo ${f} de ${t}`) });
        aoEnviar(`${tipo.nome} enviado.`);
      }
    } catch (er) {
      setErro(mensagemDeErro(er as Error));
    } finally {
      setEnviando(false);
      setProgresso(null);
    }
  }

  return (
    <Dialogo aberto titulo={`${tipo.item}. ${tipo.nome}`} aoFechar={aoFechar} largura="larga">
      <form className="formulario formulario-largo" onSubmit={enviar} noValidate>
        <p className="apoio">
          Medição de <strong>{mesPorExtenso(medicao.competencia)}</strong>, {medicao.empresa}
          {medicao.obra ? `, obra ${medicao.obra}` : ''}.
        </p>

        {item.status === 'devolvido' && item.motivo_devolucao && (
          <p className="aviso aviso-alerta">
            <strong>Devolvido pela Emais.</strong> {item.motivo_devolucao}
          </p>
        )}

        {modo === 'nao_aplica' ? (
          <label className="campo">
            <span>Por que não se aplica neste mês</span>
            <textarea
              rows={3}
              value={justificativa}
              onChange={(e) => setJustificativa(e.target.value)}
              placeholder={tipo.codigo === 'rescisao' ? 'Ex.: nenhum colaborador desligado no mês' : tipo.codigo === 'vt' ? 'Ex.: colaboradores não usam transporte público' : 'Ex.: não houve adiantamento no mês'}
            />
            <small className="dica">A Emais confere a justificativa junto com os demais documentos.</small>
          </label>
        ) : (
          <div className="campo">
            <span>Arquivo</span>
            <small className="dica">
              {tipo.coletivo
                ? 'Pode ser um arquivo só com todos os colaboradores da lista, ou um por colaborador. '
                : ''}
              PDF, JPG, PNG ou HEIC, até 10 MB cada.
            </small>
            <label className="area-arquivo">
              <input
                ref={entrada}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.heic,application/pdf,image/jpeg,image/png,image/heic"
                multiple
                onChange={(e) => adicionar(e.target.files)}
              />
              <span>{arquivos.length === 0 ? 'Escolher arquivo' : 'Adicionar outro arquivo'}</span>
            </label>
            {arquivos.length > 0 && (
              <ul className="arquivos-escolhidos">
                {arquivos.map((a, i) => (
                  <li key={`${a.name}-${i}`}>
                    <span>
                      {a.name} <span className="sub">{tamanhoArquivo(a.size)}</span>
                    </span>
                    <button type="button" className="botao botao-discreto botao-pequeno" onClick={() => setArquivos((l) => l.filter((_, j) => j !== i))}>
                      Tirar
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {problemas.map((p) => (
              <small key={p} className="campo-erro">{p}</small>
            ))}
            {item.versao > 0 && item.status !== 'nao_aplica' && (
              <small className="dica">O envio novo substitui o anterior na conferência. O anterior continua guardado.</small>
            )}
          </div>
        )}

        {modo === 'arquivo' && <TermoLgpd marcado={aceite} aoMudar={setAceite} />}

        {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}
        {progresso && <p className="aviso aviso-ok" role="status">{progresso}</p>}

        <div className="linha-botoes">
          <button className="botao" type="submit" disabled={!pronto || enviando}>
            {enviando ? 'Enviando' : modo === 'nao_aplica' ? 'Confirmar' : 'Enviar'}
          </button>
          <button className="botao botao-discreto" type="button" onClick={aoFechar}>Cancelar</button>
        </div>
      </form>
    </Dialogo>
  );
}
