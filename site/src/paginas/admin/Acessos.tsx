import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Pagina, Mensagem } from '../../componentes/Pagina';
import { Dialogo } from '../../componentes/Dialogo';
import { Carregando } from '../../componentes/Carregando';
import { mensagemDeErro, enderecoDoSite } from '../../lib/supabase';
import { nomesPerfil, useSessao, type Perfil } from '../../lib/sessao';
import { formatarCnpj } from '../../lib/consultas';
import {
  alterarAtivo, copiarTexto, criarAcesso, gerarLinkAcesso, lerAcessos, lerEmpresas, lerObras, linkOutlook,
  type Acesso, type EmpresaOpcao, type LinkAcesso, type Obra,
} from '../../lib/admin';

export function Acessos() {
  const { usuario } = useSessao();
  const [acessos, setAcessos] = useState<Acesso[] | null>(null);
  const [empresas, setEmpresas] = useState<EmpresaOpcao[]>([]);
  const [obras, setObras] = useState<Obra[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [novoAberto, setNovoAberto] = useState(false);
  const [link, setLink] = useState<LinkAcesso | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [busca, setBusca] = useState('');

  async function carregar() {
    try {
      const [a, e, o] = await Promise.all([lerAcessos(), lerEmpresas(), lerObras()]);
      setAcessos(a);
      setEmpresas(e);
      setObras(o);
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!acessos) return [];
    if (!t) return acessos;
    return acessos.filter((a) =>
      [a.nome, a.email, ...a.empresas.map((e) => e.razao_social), ...a.obras.map((o) => o.nome)].some((v) => v.toLowerCase().includes(t)),
    );
  }, [acessos, busca]);

  const semAcesso = empresas.filter((e) => !e.temAcesso).length;

  async function pedirLink(a: Acesso) {
    setErro(null);
    setOcupado(a.id);
    try {
      setLink(await gerarLinkAcesso(a.id));
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setOcupado(null);
    }
  }

  async function trocarAtivo(a: Acesso) {
    if (a.id === usuario?.id) return;
    setErro(null);
    setOcupado(a.id);
    try {
      await alterarAtivo(a.id, !a.ativo);
      setOk(a.ativo ? `Acesso de ${a.nome} desativado.` : `Acesso de ${a.nome} reativado.`);
      await carregar();
    } catch (e) {
      setErro(mensagemDeErro(e as Error));
    } finally {
      setOcupado(null);
    }
  }

  return (
    <Pagina
      titulo="Acessos"
      apoio={`Quem entra no portal. ${semAcesso > 0 ? `${semAcesso} empresas ainda não têm acesso.` : 'Todas as empresas já têm acesso.'}`}
      acoes={<button className="botao" type="button" onClick={() => setNovoAberto(true)}>Novo acesso</button>}
    >
      {erro && <Mensagem tipo="erro" aoFechar={() => setErro(null)}>{erro}</Mensagem>}
      {ok && <Mensagem tipo="ok" aoFechar={() => setOk(null)}>{ok}</Mensagem>}

      <div className="filtros">
        <label className="campo campo-busca">
          <span>Buscar</span>
          <input type="search" placeholder="Nome, e-mail, empresa ou obra" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </label>
      </div>

      {!acessos && !erro && <Carregando />}
      {acessos && (
        <div className="tabela-rolagem">
          <table className="tabela tabela-lista">
            <thead>
              <tr>
                <th scope="col">Nome</th>
                <th scope="col">Perfil</th>
                <th scope="col">Empresas ou obras</th>
                <th scope="col"><span className="sr">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((a) => (
                <tr key={a.id} className={a.ativo ? undefined : 'linha-inativa'}>
                  <th scope="row">
                    {a.nome}
                    <small className="sub">{a.email}</small>
                  </th>
                  <td>
                    {nomesPerfil[a.perfil]}
                    {!a.ativo && <small className="sub">Desativado</small>}
                  </td>
                  <td className="quebra">
                    {a.perfil === 'fornecedor' && a.empresas.map((e) => e.razao_social).join(', ')}
                    {a.perfil === 'tst' && a.obras.map((o) => o.nome).join(', ')}
                    {a.perfil === 'admin' && <span className="sub">Todas</span>}
                  </td>
                  <td className="acoes">
                    <button className="botao botao-secundario botao-pequeno" type="button" disabled={!a.ativo || ocupado === a.id} onClick={() => pedirLink(a)}>
                      Gerar link
                    </button>
                    {a.id !== usuario?.id && (
                      <button className="botao botao-discreto botao-pequeno" type="button" disabled={ocupado === a.id} onClick={() => trocarAtivo(a)}>
                        {a.ativo ? 'Desativar' : 'Reativar'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {filtrados.length === 0 && (
                <tr>
                  <td colSpan={4} className="vazio-linha">Nenhum acesso encontrado.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <NovoAcesso
        aberto={novoAberto}
        empresas={empresas}
        obras={obras}
        aoFechar={() => setNovoAberto(false)}
        aoCriar={async (l) => {
          setNovoAberto(false);
          setLink(l);
          await carregar();
        }}
      />
      <EnvioDoLink link={link} empresas={acessos?.find((a) => a.id === link?.usuario_id)?.empresas ?? []} aoFechar={() => setLink(null)} />
    </Pagina>
  );
}

function NovoAcesso({
  aberto, empresas, obras, aoFechar, aoCriar,
}: {
  aberto: boolean;
  empresas: EmpresaOpcao[];
  obras: Obra[];
  aoFechar: () => void;
  aoCriar: (l: LinkAcesso) => void;
}) {
  const [perfil, setPerfil] = useState<Perfil>('fornecedor');
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [selEmpresas, setSelEmpresas] = useState<string[]>([]);
  const [selObras, setSelObras] = useState<string[]>([]);
  const [filtroEmpresa, setFiltroEmpresa] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (aberto) {
      setPerfil('fornecedor');
      setNome('');
      setEmail('');
      setSelEmpresas([]);
      setSelObras([]);
      setFiltroEmpresa('');
      setErro(null);
    }
  }, [aberto]);

  const listaEmpresas = useMemo(() => {
    const t = filtroEmpresa.trim().toLowerCase();
    const s = t.replace(/\D/g, '');
    return empresas.filter((e) => !t || e.razao_social.toLowerCase().includes(t) || (s && e.cnpj.includes(s)));
  }, [empresas, filtroEmpresa]);

  function alternar(lista: string[], id: string) {
    return lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id];
  }

  const valido =
    nome.trim().length >= 2 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
    (perfil !== 'fornecedor' || selEmpresas.length > 0) &&
    (perfil !== 'tst' || selObras.length > 0);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!valido) return;
    setErro(null);
    setEnviando(true);
    try {
      const l = await criarAcesso({
        nome: nome.trim(),
        email: email.trim(),
        perfil,
        empresas: perfil === 'fornecedor' ? selEmpresas : [],
        obras: perfil === 'tst' ? selObras : [],
      });
      aoCriar(l);
    } catch (er) {
      setErro(mensagemDeErro(er as Error));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialogo aberto={aberto} titulo="Novo acesso" aoFechar={aoFechar} largura="larga">
      <form className="formulario formulario-largo" onSubmit={enviar} noValidate>
        <fieldset className="opcoes">
          <legend>Perfil</legend>
          {(['fornecedor', 'tst', 'admin'] as Perfil[]).map((p) => (
            <label key={p} className="opcao">
              <input type="radio" name="perfil" value={p} checked={perfil === p} onChange={() => setPerfil(p)} />
              <span>{nomesPerfil[p]}</span>
            </label>
          ))}
        </fieldset>

        <div className="grade-2">
          <label className="campo">
            <span>{perfil === 'fornecedor' ? 'Nome do responsável ou da empresa' : 'Nome'}</span>
            <input value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="off" />
          </label>
          <label className="campo">
            <span>E-mail de acesso</span>
            <input type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          </label>
        </div>

        {perfil === 'fornecedor' && (
          <div className="campo">
            <span>Empresas que este acesso representa</span>
            <small className="dica">Cada empresa tem um único acesso. Um escritório de contabilidade pode responder por várias.</small>
            <input type="search" placeholder="Buscar por nome ou CNPJ" value={filtroEmpresa} onChange={(e) => setFiltroEmpresa(e.target.value)} />
            <ul className="lista-marcar" aria-label="Empresas">
              {listaEmpresas.map((e) => (
                <li key={e.id}>
                  <label className={e.temAcesso ? 'desativada' : undefined}>
                    <input
                      type="checkbox"
                      disabled={e.temAcesso}
                      checked={selEmpresas.includes(e.id)}
                      onChange={() => setSelEmpresas((l) => alternar(l, e.id))}
                    />
                    <span>
                      {e.razao_social}
                      <small className="sub">{formatarCnpj(e.cnpj)}{e.temAcesso ? ', já tem acesso' : ''}</small>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        {perfil === 'tst' && (
          <div className="campo">
            <span>Obras sob responsabilidade</span>
            <ul className="lista-marcar lista-curta" aria-label="Obras">
              {obras.map((o) => (
                <li key={o.id}>
                  <label>
                    <input type="checkbox" checked={selObras.includes(o.id)} onChange={() => setSelObras((l) => alternar(l, o.id))} />
                    <span>{o.nome}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        {perfil === 'admin' && <p className="apoio">O administrativo vê todas as obras e é o único perfil que abre os arquivos enviados.</p>}

        {erro && <p className="aviso aviso-erro" role="alert">{erro}</p>}

        <div className="linha-botoes">
          <button className="botao" type="submit" disabled={!valido || enviando}>
            {enviando ? 'Criando' : 'Criar acesso e gerar link'}
          </button>
          <button className="botao botao-discreto" type="button" onClick={aoFechar}>Cancelar</button>
        </div>
      </form>
    </Dialogo>
  );
}

function EnvioDoLink({ link, empresas, aoFechar }: { link: LinkAcesso | null; empresas: { razao_social: string }[]; aoFechar: () => void }) {
  const [copiado, setCopiado] = useState<string | null>(null);
  useEffect(() => setCopiado(null), [link]);
  if (!link) return <Dialogo aberto={false} titulo="" aoFechar={aoFechar}>{null}</Dialogo>;

  const primeiroNome = link.nome.split(' ')[0];
  const motivo =
    link.perfil === 'fornecedor'
      ? `É por ele que ${empresas.length === 1 ? `a ${empresas[0].razao_social}` : 'as suas empresas'} vai cadastrar os colaboradores e enviar a documentação para as obras da Emais.`
      : link.perfil === 'tst'
        ? 'É por ele que você vai consultar os colaboradores das suas obras e dar a validação final da segurança do trabalho.'
        : 'É por ele que você vai conferir a documentação dos terceiros e liberar os colaboradores para as obras.';
  const assunto = link.primeiro_acesso ? 'Seu acesso ao Portal de Terceiros da Emais' : 'Nova senha do Portal de Terceiros da Emais';
  const corpo = link.primeiro_acesso
    ? `Olá, ${primeiroNome},\n\nSeu acesso ao Portal de Terceiros do Grupo Emais foi criado. ${motivo}\n\nPara criar sua senha, abra o link abaixo. Ele só pode ser usado uma vez e vale por tempo limitado; se não funcionar, responda este e-mail que mandamos outro.\n\n${link.link}\n\nDepois, entre sempre por ${enderecoDoSite} com o e-mail ${link.email}.\n\nAtenciosamente,\nGente e Gestão\nGrupo Emais`
    : `Olá, ${primeiroNome},\n\nSegue o link para criar uma nova senha no Portal de Terceiros do Grupo Emais. Ele só pode ser usado uma vez e vale por tempo limitado.\n\n${link.link}\n\nDepois, entre por ${enderecoDoSite} com o e-mail ${link.email}.\n\nAtenciosamente,\nGente e Gestão\nGrupo Emais`;

  async function copiar(texto: string, qual: string) {
    try {
      await copiarTexto(texto);
      setCopiado(qual);
    } catch {
      setCopiado('falhou');
    }
  }

  return (
    <Dialogo aberto titulo={link.primeiro_acesso ? 'Acesso criado' : 'Link de nova senha'} aoFechar={aoFechar} largura="larga">
      <div className="formulario formulario-largo">
        <p className="apoio">
          Envie o e-mail abaixo para <strong>{link.email}</strong>. O portal não dispara e-mail sozinho: o envio sai pelo seu Outlook.
        </p>
        <div className="previa-email">
          <p><span className="sub">Assunto</span> {assunto}</p>
          <pre>{corpo}</pre>
        </div>
        <div className="linha-botoes">
          <a className="botao" href={linkOutlook(link.email, assunto, corpo)}>Abrir no Outlook</a>
          <button className="botao botao-secundario" type="button" onClick={() => copiar(corpo, 'texto')}>Copiar texto</button>
          <button className="botao botao-discreto" type="button" onClick={() => copiar(link.link, 'link')}>Copiar só o link</button>
        </div>
        {copiado === 'texto' && <p className="aviso aviso-ok" role="status">Texto copiado.</p>}
        {copiado === 'link' && <p className="aviso aviso-ok" role="status">Link copiado.</p>}
        {copiado === 'falhou' && <p className="aviso aviso-erro" role="alert">O navegador não deixou copiar. Selecione o texto e copie com Ctrl+C.</p>}
      </div>
    </Dialogo>
  );
}
