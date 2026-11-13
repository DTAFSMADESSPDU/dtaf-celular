// Aplicativo do celular do DTAF: so visualiza o espelho que o computador servidor envia (D03, D53). Nenhum texto vira HTML (a tela
// e montada por elementos e textContent), sem avaliar codigo, sem biblioteca externa. Cada pessoa ve so o que o modulo e os fundos
// dela permitem: quem decide e o banco (RLS), nao esta tela.
import { carregarSessao, emailDaSessao, entrar, sair, lerTabela, trocarSenha, ErroNuvem } from './nuvem.js';
import * as d from './dados.js';
import * as g from './graficos.js';
import * as pn from './paineis.js';

const raiz = document.getElementById('raiz');
const ABAS = [['painel', 'Painel'], ['contratos', 'Contratos'], ['compras', 'Compras diretas'], ['tac', 'TAC'], ['fundos', 'Fundos'], ['pendencias', 'Pendências'],
  ['numeracao', 'Numeração'], ['administracao', 'Administração']];
const TABELAS = ['espelho_meta', 'usuario', 'permissao', 'usuario_fundo', 'contrato_fiscal', 'numeracao_uso', 'parametro', 'calendario_dia', 'auditoria',
  'lista_valor', 'natureza_compra', 'limite_legal', 'fundo', 'fundo_conta', 'fundo_lancamento', 'fornecedor',
  'contrato', 'contrato_movimento', 'contrato_fundo', 'compra_direta', 'compra_fornecedor', 'compra_fundo', 'compra_item', 'tac', 'tac_pagamento',
  'pendencia', 'conferencia_campo'];

const E = { dados: null, ix: null, aba: 'painel', detalhe: null, busca: '', filtro: { contratos: 'todos', pendencias: 'abertas' }, hoje: d.hojeISO(), modulos: new Set(),
  sub: { contratos: 'painel', compras: 'limites', tac: 'painel', administracao: 'usuarios' }, filtroIds: null, anoLimites: null, anoCompras: null, unidade: null, todosFundos: false,
  eu: null, num: { tipo: 'oficio', ano: null, faixa: null }, auditoria: { limite: 100, busca: '', modulo: '' } };

// ---------------------------------------------------------------------------------------------------------------- construcao da tela
function h(tag, atributos, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(atributos || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat()) {
    if (f === null || f === undefined || f === false) continue;
    e.append(f);
  }
  return e;
}

const selo = (texto, tipo = 'neutro') => h('span', { class: `selo ${tipo}` }, texto);
const vazio = (v) => v === null || v === undefined || v === '';

function trocar(el, ...filhos) {
  el.replaceChildren(...filhos.flat().filter((f) => f !== null && f !== undefined && f !== false));
}

// ---------------------------------------------------------------------------------------------------------------- dados
function agrupar(linhas, chave) {
  const m = new Map();
  for (const x of linhas) {
    if (!m.has(x[chave])) m.set(x[chave], []);
    m.get(x[chave]).push(x);
  }
  return m;
}

function indexar(dados) {
  const por = (linhas, chave) => new Map(linhas.map((x) => [x[chave], x]));
  return {
    forn: por(dados.fornecedor, 'id'),
    fundo: por(dados.fundo, 'id'),
    contrato: por(dados.contrato, 'id'),
    compra: por(dados.compra_direta, 'id'),
    tac: por(dados.tac, 'id'),
    conta: por(dados.fundo_conta, 'id'),
    movs: agrupar(dados.contrato_movimento, 'contrato_id'),
    cfundos: agrupar(dados.contrato_fundo, 'contrato_id'),
    compraForn: agrupar(dados.compra_fornecedor, 'compra_id'),
    itens: agrupar(dados.compra_item, 'compra_id'),
    comprasFundos: agrupar(dados.compra_fundo, 'compra_id'),
    pags: agrupar(dados.tac_pagamento, 'tac_id'),
    contas: agrupar(dados.fundo_conta, 'fundo_id'),
    lanc: agrupar(dados.fundo_lancamento, 'conta_id'),
    rotulos: new Map(dados.lista_valor.map((l) => [`${l.lista}/${l.codigo}`, l.rotulo])),
    conferido: new Map(dados.conferencia_campo.map((c) => [`${c.entidade}/${c.entidade_id}/${c.campo}`, c.vigente])),
    calculos: new Map(),
  };
}

const rotulo = (lista, codigo) => (vazio(codigo) ? '' : E.ix.rotulos.get(`${lista}/${codigo}`) || codigo);

function contratoCalc(c) {
  if (!E.ix.calculos.has(c.id)) {
    const movs = E.ix.movs.get(c.id) || [];
    const vigencia = d.calcularVigencia(c, movs);
    E.ix.calculos.set(c.id, { vigencia, alerta: d.alerta(vigencia.fim, E.hoje), valor: d.valorAtual(c, movs), movs });
  }
  return E.ix.calculos.get(c.id);
}

function tacCalc(t) {
  return d.saldoTac(t, E.ix.pags.get(t.id) || []);
}

function saldoDoFundo(fundoId) {
  const contas = E.ix.contas.get(fundoId) || [];
  return contas.reduce((s, c) => s + d.saldoConta(c, E.ix.lanc.get(c.id) || []), 0);
}

async function carregar() {
  const lidas = await Promise.all(TABELAS.map((t) => lerTabela(t)));
  E.dados = Object.fromEntries(TABELAS.map((t, i) => [t, lidas[i]]));
  E.ix = indexar(E.dados);
  E.hoje = d.hojeISO();
  const email = emailDaSessao().toLowerCase();
  E.eu = E.dados.usuario.find((x) => x.email.toLowerCase() === email) || null; // quem tem Administracao recebe todos os usuarios: o proprio e achado pelo e-mail
  E.modulos = new Set(E.dados.permissao.filter((x) => E.eu && x.usuario_id === E.eu.id && x.acao === 'ver').map((x) => x.modulo));
  E.todosFundos = E.eu !== null && E.eu.todos_fundos === 1;
  if (!E.todosFundos) E.sub.compras = 'analise';
}

// ---------------------------------------------------------------------------------------------------------------- pecas comuns
function conferencia(entidade, id, campo) {
  const chave = `${entidade}/${id}/${campo}`;
  if (!E.ix.conferido.has(chave)) return null;
  return E.ix.conferido.get(chave) === false ? selo('Alterado após conferir', 'atencao') : selo('Conferido', 'ok');
}

function linhaCampo(nome, valor, selos) {
  if (vazio(valor)) return null;
  return h('div', { class: 'campo' }, h('dt', {}, nome), h('dd', {}, valor, selos ? [' ', selos] : null));
}

const grupo = (titulo, ...linhas) => {
  const filhas = linhas.flat().filter(Boolean);
  return filhas.length ? h('section', { class: 'grupo' }, h('h3', {}, titulo), h('dl', {}, filhas)) : null;
};

function cartao(titulo, selos, ...corpo) {
  return { titulo, selos, corpo };
}

function botaoCartao(conteudo, aoAbrir) {
  return h('button', { class: 'cartao', type: 'button', onclick: aoAbrir },
    h('div', { class: 'linha' }, h('strong', {}, conteudo.titulo), conteudo.selos),
    conteudo.corpo.flat().filter(Boolean));
}

function volta(texto, destino) {
  return h('button', { class: 'voltar', type: 'button', onclick: () => ir(destino) }, `‹ ${texto}`);
}

function bloqueado() {
  return h('p', { class: 'vazio' }, 'Sem acesso a este módulo.');
}

// ---------------------------------------------------------------------------------------------------------------- navegacao
function ir(destino) {
  location.hash = destino;
}

function lerHash() {
  const [, aba, id] = location.hash.split('/');
  E.senha = aba === 'senha';
  const valida = ABAS.some(([k]) => k === aba);
  E.aba = valida ? aba : 'painel';
  E.detalhe = valida && id ? id : null;
}

// ---------------------------------------------------------------------------------------------------------------- painel
function seloContrato(c) {
  const k = contratoCalc(c);
  if (c.situacao !== 'vigente') return selo(rotulo('situacao_contrato', c.situacao), 'neutro');
  if (k.alerta.situacao === 'vencido') return selo('Vencido', 'erro');
  if (k.alerta.situacao === 'a_vencer') return selo(`A vencer · ${k.alerta.dias} d`, 'atencao');
  if (k.alerta.situacao === 'a_definir') return selo('Vigência a definir', 'neutro');
  return selo('Vigente', 'ok');
}

function tile(nome, valor, apoio, destino) {
  return h('button', { class: 'tile', type: 'button', onclick: () => ir(destino) }, h('span', { class: 'tile-nome' }, nome), h('span', { class: 'tile-valor' }, valor), apoio ? h('span', { class: 'tile-apoio' }, apoio) : null);
}

function viewPainel() {
  const tiles = [];
  const D = E.dados;
  if (E.modulos.has('contratos')) {
    const vigentes = D.contrato.filter((c) => c.situacao === 'vigente' && contratoCalc(c).alerta.situacao !== 'vencido');
    const aVencer = vigentes.filter((c) => contratoCalc(c).alerta.dias !== null && contratoCalc(c).alerta.dias <= 90);
    const vencidos = D.contrato.filter((c) => c.situacao === 'vigente' && contratoCalc(c).alerta.situacao === 'vencido');
    tiles.push(tile('Contratos vigentes', String(vigentes.length), d.reais(vigentes.reduce((s, c) => s + (contratoCalc(c).valor || 0), 0)), '#/contratos'));
    tiles.push(tile('A vencer em 90 dias', String(aVencer.length), '', '#/contratos'));
    tiles.push(tile('Vencidos', String(vencidos.length), '', '#/contratos'));
  }
  if (E.modulos.has('compras')) tiles.push(tile('Compras diretas', String(D.compra_direta.length), d.reais(D.compra_direta.reduce((s, c) => s + c.valor_total_centavos, 0)), '#/compras'));
  if (E.modulos.has('tac')) {
    const abertos = D.tac.filter((t) => !tacCalc(t).quitado && t.situacao !== 'cancelado');
    tiles.push(tile('TAC a pagar', String(abertos.length), d.reais(abertos.reduce((s, t) => s + tacCalc(t).saldo, 0)), '#/tac'));
  }
  if (E.modulos.has('fundos')) tiles.push(tile('Saldo dos fundos', d.reais(D.fundo.reduce((s, f) => s + saldoDoFundo(f.id), 0)), `${D.fundo.length} fundo(s)`, '#/fundos'));
  if (E.modulos.has('pendencias')) tiles.push(tile('Pendências abertas', String(D.pendencia.filter((p) => ['aberta', 'em_andamento'].includes(p.situacao)).length), '', '#/pendencias'));
  const proximos = E.modulos.has('contratos')
    ? D.contrato.filter((c) => c.situacao === 'vigente' && contratoCalc(c).alerta.dias !== null && contratoCalc(c).alerta.dias >= 0)
      .sort((a, b) => contratoCalc(a).alerta.dias - contratoCalc(b).alerta.dias).slice(0, 5)
    : [];
  return h('div', {}, tiles.length ? h('div', { class: 'tiles' }, tiles) : bloqueado(),
    proximos.length ? h('section', { class: 'grupo' }, h('h3', {}, 'Próximos vencimentos'),
      proximos.map((c) => botaoCartao(cartao(`${c.numero}/${c.ano}`, seloContrato(c), h('div', { class: 'suave' }, fornecedorNome(c)), h('div', { class: 'linha pequena' }, h('span', {}, `Fim: ${d.dataBR(contratoCalc(c).vigencia.fim)}`))), () => ir(`#/contratos/${c.id}`)))) : null);
}

// ---------------------------------------------------------------------------------------------------------------- listas com busca
function viewLista({ aba, textoBusca, itens, cartaoDe, chips }) {
  const lista = h('div', { class: 'lista' });
  const contador = h('p', { class: 'contador', role: 'status' });
  const idsFiltro = E.filtroIds && E.filtroIds.aba === aba ? new Set(E.filtroIds.ids) : null;
  const filtrar = () => {
    const q = d.normalizar(E.busca);
    const filtrados = itens().filter((x) => (!idsFiltro || idsFiltro.has(x.id)) && (!q || d.normalizar(textoBusca(x)).includes(q)));
    contador.textContent = `${filtrados.length} registro(s)`;
    trocar(lista, filtrados.map((x) => botaoCartao(cartaoDe(x), () => ir(`#/${aba}/${x.id}`))));
  };
  const campoBusca = h('input', { class: 'busca', type: 'search', placeholder: 'Buscar', 'aria-label': 'Buscar', value: E.busca, oninput: (ev) => { E.busca = ev.target.value; filtrar(); } });
  const faixa = chips ? h('div', { class: 'chips' }, chips(filtrar)) : null;
  const aviso = idsFiltro ? h('div', { class: 'filtro-ativo' }, `Filtro do gráfico: ${E.filtroIds.rotulo}`, h('button', { type: 'button', 'aria-label': 'Limpar o filtro', onclick: () => { E.filtroIds = null; desenhar(); } }, '✕')) : null;
  filtrar();
  return h('div', {}, subabas(aba), campoBusca, aviso, faixa, contador, lista);
}

function chipsDe(aba, opcoes, aoMudar) {
  const botoes = opcoes.map(([valor, texto]) => h('button', {
    class: 'chip', type: 'button', 'aria-pressed': String(E.filtro[aba] === valor),
    onclick: (ev) => { E.filtro[aba] = valor; botoes.forEach((b) => b.setAttribute('aria-pressed', 'false')); ev.currentTarget.setAttribute('aria-pressed', 'true'); aoMudar(); },
  }, texto));
  return botoes;
}

const fornecedorNome = (c) => {
  const f = E.ix.forn.get(c.fornecedor_id);
  return f ? f.razao_social : '';
};

// ---------------------------------------------------------------------------------------------------------------- contratos
function viewContratos() {
  if (!E.modulos.has('contratos')) return bloqueado();
  if (E.detalhe) return fichaContrato(E.ix.contrato.get(Number(E.detalhe)));
  if (E.sub.contratos === 'painel') return h('div', {}, subabas('contratos'), painelContratosView());
  const filtros = { todos: () => true, vigentes: (c) => c.situacao === 'vigente' && contratoCalc(c).alerta.situacao !== 'vencido',
    a_vencer: (c) => c.situacao === 'vigente' && contratoCalc(c).alerta.situacao === 'a_vencer', vencidos: (c) => c.situacao === 'vigente' && contratoCalc(c).alerta.situacao === 'vencido' };
  return viewLista({
    aba: 'contratos',
    itens: () => E.dados.contrato.filter(filtros[E.filtro.contratos] || filtros.todos).sort((a, b) => b.ano - a.ano || String(b.numero).localeCompare(String(a.numero), 'pt-BR', { numeric: true })),
    textoBusca: (c) => `${c.numero}/${c.ano} ${fornecedorNome(c)} ${c.objeto} ${c.processo_adm} ${c.contratante}`,
    chips: (aoMudar) => chipsDe('contratos', [['todos', 'Todos'], ['vigentes', 'Vigentes'], ['a_vencer', 'A vencer'], ['vencidos', 'Vencidos']], aoMudar),
    cartaoDe: (c) => cartao(`${c.numero}/${c.ano}`, seloContrato(c), h('div', { class: 'suave' }, fornecedorNome(c)), h('div', { class: 'objeto' }, c.objeto),
      h('div', { class: 'linha pequena' }, h('span', {}, contratoCalc(c).vigencia.fim ? `Fim: ${d.dataBR(contratoCalc(c).vigencia.fim)}` : ''), h('span', { class: 'valor' }, d.reais(contratoCalc(c).valor)))),
  });
}

function fichaContrato(c) {
  if (!c) return h('div', {}, volta('Contratos', '#/contratos'), h('p', { class: 'vazio' }, 'Contrato não encontrado.'));
  const k = contratoCalc(c);
  const cf = (campo) => conferencia('contrato', c.id, campo);
  const fundos = (E.ix.cfundos.get(c.id) || []).map((x) => (E.ix.fundo.get(x.fundo_id) || {}).sigla || (E.ix.fundo.get(x.fundo_id) || {}).nome).filter(Boolean);
  const origemVig = k.vigencia.origem === 'a_definir' ? '' : ` (${k.vigencia.origem.startsWith('aditivo') ? k.vigencia.origem : `${k.vigencia.origem}`})`;
  return h('div', {}, volta('Contratos', '#/contratos'),
    h('div', { class: 'ficha-topo' }, h('h2', {}, `Contrato ${c.numero}/${c.ano}`), seloContrato(c)),
    grupo('Dados', linhaCampo('Fornecedor', fornecedorNome(c), cf('fornecedor')), linhaCampo('Objeto', c.objeto, cf('objeto')), linhaCampo('Contratante', c.contratante, cf('contratante')),
      linhaCampo('Origem', rotulo('origem_contrato', c.origem), cf('origem')), linhaCampo('Número da origem', c.origem_numero, cf('origem_numero')),
      linhaCampo('Processo (SIGED)', c.processo_adm, cf('processo_adm')), linhaCampo('Assinatura', d.dataBR(c.data_assinatura), cf('data_assinatura')), linhaCampo('Fundos', fundos.join(', ')), linhaCampo('Observações', c.observacoes)),
    fiscaisDoContrato(c),
    grupo('Vigência', linhaCampo('Início', d.dataBR(k.vigencia.inicio), cf('vigencia_inicio')), linhaCampo('Prazo (meses)', c.prazo_meses, cf('prazo_meses')),
      linhaCampo('Fim', k.vigencia.fim ? `${d.dataBR(k.vigencia.fim)}${origemVig}` : 'A definir', cf('vigencia_fim_informada')),
      linhaCampo('Dias para o fim', k.alerta.dias === null ? '' : String(k.alerta.dias))),
    grupo('Valores', linhaCampo('Valor inicial', d.reais(c.valor_inicial_centavos), cf('valor_inicial_centavos')), linhaCampo('Valor atual', d.reais(k.valor))),
    k.movs.length ? h('section', { class: 'grupo' }, h('h3', {}, 'Aditivos e apostilamentos'), k.movs.sort((a, b) => (a.ordem || 0) - (b.ordem || 0)).map((m) => h('div', { class: 'subcartao' },
      h('div', { class: 'linha' }, h('strong', {}, `${m.ordem || ''}º ${rotulo('tipo_movimento', m.tipo)}`.trim()), h('span', { class: 'suave' }, d.dataBR(m.data_assinatura))),
      h('dl', {}, linhaCampo('Nova vigência', [d.dataBR(m.nova_vigencia_inicio), d.dataBR(m.nova_vigencia_fim)].filter(Boolean).join(' a ')), linhaCampo('Prazo (meses)', m.prazo_meses),
        linhaCampo('Variação de valor', d.reais(m.valor_variacao_centavos)), linhaCampo('Novo valor global', d.reais(m.novo_valor_global_centavos)), linhaCampo('Fundamento legal', m.fundamento_legal),
        linhaCampo('Processo (SIGED)', m.processo_adm), linhaCampo('Parecer', m.parecer), linhaCampo('Observações', m.observacoes))))) : null);
}

function fiscaisDoContrato(c) {
  const fiscais = E.dados.contrato_fiscal.filter((f) => f.contrato_id === c.id);
  if (!fiscais.length) return null;
  return grupo('Fiscalização', fiscais.map((f) => linhaCampo(rotulo('papel_fiscalizacao', f.papel),
    [f.nome, f.portaria ? `portaria ${f.portaria}` : '', f.desde || f.ate ? `${d.dataBR(f.desde)} a ${d.dataBR(f.ate) || 'atual'}` : ''].filter(Boolean).join(' · '))));
}

// ---------------------------------------------------------------------------------------------------------------- compras diretas
function viewCompras() {
  if (!E.modulos.has('compras')) return bloqueado();
  if (E.detalhe) return fichaCompra(E.ix.compra.get(Number(E.detalhe)));
  if (E.sub.compras === 'limites' && E.todosFundos) return h('div', {}, subabas('compras'), limitesView());
  if (E.sub.compras === 'analise') return h('div', {}, subabas('compras'), analiseComprasView());
  const nome = (c) => `${c.modalidade} ${c.numero}/${c.ano}`;
  return viewLista({
    aba: 'compras',
    itens: () => [...E.dados.compra_direta].sort((a, b) => b.ano - a.ano || String(b.numero).localeCompare(String(a.numero), 'pt-BR', { numeric: true })),
    textoBusca: (c) => `${nome(c)} ${c.objeto_resumo} ${c.unidade_gestora} ${c.processo_adm} ${(E.ix.compraForn.get(c.id) || []).map((x) => (E.ix.forn.get(x.fornecedor_id) || {}).razao_social).join(' ')}`,
    cartaoDe: (c) => cartao(nome(c), c.tipo ? selo(rotulo('ramo_compra', c.tipo), 'neutro') : null, h('div', { class: 'objeto' }, c.objeto_resumo),
      h('div', { class: 'linha pequena' }, h('span', {}, d.dataBR(c.data_publicacao)), h('span', { class: 'valor' }, d.reais(c.valor_total_centavos)))),
  });
}

function fichaCompra(c) {
  if (!c) return h('div', {}, volta('Compras diretas', '#/compras'), h('p', { class: 'vazio' }, 'Compra não encontrada.'));
  const cf = (campo) => conferencia('compra_direta', c.id, campo);
  const fornecedores = E.ix.compraForn.get(c.id) || [];
  const itens = [...(E.ix.itens.get(c.id) || [])].sort((a, b) => (a.lote || 0) - (b.lote || 0) || (a.item || 0) - (b.item || 0));
  const fundos = (E.ix.comprasFundos.get(c.id) || []).map((x) => (E.ix.fundo.get(x.fundo_id) || {}).sigla || (E.ix.fundo.get(x.fundo_id) || {}).nome).filter(Boolean);
  return h('div', {}, volta('Compras diretas', '#/compras'), h('div', { class: 'ficha-topo' }, h('h2', {}, `${c.modalidade} ${c.numero}/${c.ano}`)),
    grupo('Dados', linhaCampo('Objeto', c.objeto_resumo), linhaCampo('Unidade gestora', c.unidade_gestora, cf('unidade_gestora')), linhaCampo('Processo (SIGED)', c.processo_adm, cf('processo_adm')),
      linhaCampo('Publicação', d.dataBR(c.data_publicacao), cf('data_publicacao')), linhaCampo('Ramo', rotulo('ramo_compra', c.tipo)), linhaCampo('Total', d.reais(c.valor_total_centavos), cf('valor_total_centavos')),
      linhaCampo('Fundos', fundos.join(', ')), linhaCampo('Condutor', c.condutor), linhaCampo('Observações', c.observacoes)),
    fornecedores.length ? h('section', { class: 'grupo' }, h('h3', {}, 'Vencedores'), fornecedores.map((x) => h('div', { class: 'subcartao' }, h('div', { class: 'linha' },
      h('strong', {}, (E.ix.forn.get(x.fornecedor_id) || {}).razao_social || ''), h('span', { class: 'valor' }, d.reais(x.valor_centavos)))))) : null,
    itens.length ? h('section', { class: 'grupo' }, h('h3', {}, 'Itens'), itens.map((i) => h('div', { class: 'subcartao' },
      h('div', { class: 'linha' }, h('strong', {}, [i.lote ? `Lote ${i.lote} ` : '', i.item ? `Item ${i.item}` : ''].join('').trim() || 'Item'), h('span', { class: 'valor' }, d.reais(i.valor_total_centavos))),
      h('div', {}, i.descricao),
      h('div', { class: 'suave pequena' }, [i.quantidade ? `${i.quantidade} ${i.unidade || ''}`.trim() : '', i.valor_unitario ? `unitário ${i.valor_unitario}` : ''].filter(Boolean).join(' · '))))) : null);
}

// ---------------------------------------------------------------------------------------------------------------- TAC
function seloTac(t) {
  const k = tacCalc(t);
  return k.quitado ? selo('Pago', 'ok') : selo(rotulo('situacao_tac', t.situacao), 'neutro');
}

function viewTac() {
  if (!E.modulos.has('tac')) return bloqueado();
  if (E.detalhe) return fichaTac(E.ix.tac.get(Number(E.detalhe)));
  if (E.sub.tac === 'painel') return h('div', {}, subabas('tac'), painelTacView());
  const credor = (t) => (E.ix.forn.get(t.credor_id) || {}).razao_social || '';
  return viewLista({
    aba: 'tac',
    itens: () => [...E.dados.tac].sort((a, b) => b.ano - a.ano || String(b.numero).localeCompare(String(a.numero), 'pt-BR', { numeric: true })),
    textoBusca: (t) => `${t.numero}/${t.ano} ${t.devedor} ${t.secretaria} ${credor(t)} ${t.objeto} ${t.processo_adm}`,
    cartaoDe: (t) => cartao(`TAC ${t.numero}/${t.ano}`, seloTac(t), h('div', { class: 'suave' }, credor(t)), h('div', { class: 'objeto' }, t.objeto),
      h('div', { class: 'linha pequena' }, h('span', {}, tacCalc(t).saldo > 0 ? `A pagar ${d.reais(tacCalc(t).saldo)}` : ''), h('span', { class: 'valor' }, d.reais(t.valor_centavos)))),
  });
}

function fichaTac(t) {
  if (!t) return h('div', {}, volta('TAC', '#/tac'), h('p', { class: 'vazio' }, 'TAC não encontrado.'));
  const cf = (campo) => conferencia('tac', t.id, campo);
  const k = tacCalc(t);
  const pagamentos = [...(E.ix.pags.get(t.id) || [])].sort((a, b) => String(a.data || '9999').localeCompare(String(b.data || '9999')));
  return h('div', {}, volta('TAC', '#/tac'), h('div', { class: 'ficha-topo' }, h('h2', {}, `TAC ${t.numero}/${t.ano}`), seloTac(t)),
    grupo('Dados', linhaCampo('Devedor', t.devedor, cf('devedor')), linhaCampo('Secretaria', t.secretaria), linhaCampo('Credor', (E.ix.forn.get(t.credor_id) || {}).razao_social, cf('credor')),
      linhaCampo('Objeto', t.objeto), linhaCampo('Período', t.periodo, cf('periodo')), linhaCampo('Abrangência', t.abrangencia), linhaCampo('Fundamento legal', t.fundamento_legal),
      linhaCampo('Processo (SIGED)', t.processo_adm, cf('processo_adm')), linhaCampo('Assinatura', d.dataBR(t.data_assinatura)), linhaCampo('Documento', d.dataBR(t.data_documento)),
      linhaCampo('Publicação', d.dataBR(t.data_publicacao)), linhaCampo('Motivo da ausência de contrato', t.motivo_sem_contrato), linhaCampo('Notas fiscais', t.notas_fiscais),
      linhaCampo('Condição de pagamento', t.pagamento_condicao), linhaCampo('Parecer jurídico', t.parecer_juridico, cf('parecer_juridico')), linhaCampo('Observações', t.observacoes)),
    grupo('Valores', linhaCampo('Valor reconhecido', d.reais(t.valor_centavos), cf('valor_centavos')), linhaCampo('Notas fiscais', d.reais(t.valor_notas_fiscais_centavos)),
      linhaCampo('Glosa', d.reais(t.valor_glosa_centavos)), linhaCampo('Ressalva', d.reais(t.valor_ressalvado_centavos)), linhaCampo('Pago', d.reais(k.pago)), linhaCampo('Saldo a pagar', d.reais(k.saldo))),
    grupo('Empenho', linhaCampo('Nota de empenho', t.nota_empenho, cf('nota_empenho')), linhaCampo('Valor', d.reais(t.valor_empenho_centavos)), linhaCampo('Data', d.dataBR(t.data_empenho)),
      linhaCampo('Dotação', t.dotacao), linhaCampo('Fonte de recurso', t.fonte_recurso)),
    pagamentos.length ? h('section', { class: 'grupo' }, h('h3', {}, 'Pagamentos'), pagamentos.map((p) => h('div', { class: 'subcartao' }, h('div', { class: 'linha' },
      h('strong', {}, p.data ? d.dataBR(p.data) : 'Sem data'), h('span', { class: 'valor' }, d.reais(p.valor_centavos))), [p.referencia, p.observacoes].filter(Boolean).length ? h('div', { class: 'suave pequena' }, [p.referencia, p.observacoes].filter(Boolean).join(' · ')) : null))) : null);
}

// ---------------------------------------------------------------------------------------------------------------- fundos
function viewFundos() {
  if (!E.modulos.has('fundos')) return bloqueado();
  if (E.detalhe) return fichaFundo(E.ix.fundo.get(Number(E.detalhe)));
  return viewLista({
    aba: 'fundos',
    itens: () => [...E.dados.fundo].sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR')),
    textoBusca: (f) => `${f.nome} ${f.sigla} ${f.unidade_gestora} ${f.finalidade}`,
    cartaoDe: (f) => cartao(f.sigla || f.nome, null, f.sigla ? h('div', { class: 'suave' }, f.nome) : null,
      h('div', { class: 'linha pequena' }, h('span', {}, `${(E.ix.contas.get(f.id) || []).length} conta(s)`), h('span', { class: 'valor' }, d.reais(saldoDoFundo(f.id))))),
  });
}

function fichaFundo(f) {
  if (!f) return h('div', {}, volta('Fundos', '#/fundos'), h('p', { class: 'vazio' }, 'Fundo não encontrado.'));
  const contas = E.ix.contas.get(f.id) || [];
  return h('div', {}, volta('Fundos', '#/fundos'), h('div', { class: 'ficha-topo' }, h('h2', {}, f.sigla || f.nome)),
    grupo('Dados', linhaCampo('Nome', f.nome), linhaCampo('Unidade gestora', f.unidade_gestora), linhaCampo('Finalidade', f.finalidade), linhaCampo('Fonte de recursos', f.fonte_recursos),
      linhaCampo('CNPJ', f.cnpj), linhaCampo('Saldo', d.reais(saldoDoFundo(f.id)))),
    contas.map((c) => {
      const lancamentos = [...(E.ix.lanc.get(c.id) || [])].sort((a, b) => String(b.data).localeCompare(String(a.data)) || b.id - a.id);
      return h('section', { class: 'grupo' }, h('h3', {}, c.descricao), h('div', { class: 'linha' }, h('span', { class: 'suave' }, 'Saldo'), h('strong', { class: 'valor' }, d.reais(d.saldoConta(c, E.ix.lanc.get(c.id) || [])))),
        lancamentos.map((l) => h('div', { class: 'subcartao' }, h('div', { class: 'linha' }, h('strong', {}, `${d.dataBR(l.data)} · ${rotulo('natureza_lancamento', l.tipo)}`),
          h('span', { class: `valor ${['entrada', 'resgate'].includes(l.tipo) ? 'entra' : 'sai'}` }, d.reais(l.valor_centavos))), [l.descricao, l.documento ? `Doc. ${l.documento}` : ''].filter(Boolean).length ? h('div', { class: 'suave pequena' }, [l.descricao, l.documento ? `Doc. ${l.documento}` : ''].filter(Boolean).join(' · ')) : null)));
    }));
}

// ---------------------------------------------------------------------------------------------------------------- pendencias
function viewPendencias() {
  if (!E.modulos.has('pendencias')) return bloqueado();
  if (E.detalhe) return fichaPendencia(E.dados.pendencia.find((p) => p.id === Number(E.detalhe)));
  const abertas = (p) => ['aberta', 'em_andamento'].includes(p.situacao);
  return viewLista({
    aba: 'pendencias',
    itens: () => E.dados.pendencia.filter((p) => E.filtro.pendencias === 'todas' || abertas(p)).sort((a, b) => String(a.prazo || '9999').localeCompare(String(b.prazo || '9999'))),
    textoBusca: (p) => `${p.titulo} ${p.descricao} ${p.tipo}`,
    chips: (aoMudar) => chipsDe('pendencias', [['abertas', 'Abertas'], ['todas', 'Todas']], aoMudar),
    cartaoDe: (p) => cartao(p.titulo, seloPendencia(p), p.descricao ? h('div', { class: 'objeto' }, p.descricao) : null,
      h('div', { class: 'linha pequena' }, h('span', {}, p.prazo ? `Prazo ${d.dataBR(p.prazo)}` : ''), h('span', {}, rotulo('prioridade_pendencia', p.prioridade)))),
  });
}

function seloPendencia(p) {
  if (['aberta', 'em_andamento'].includes(p.situacao) && p.prazo && p.prazo < E.hoje) return selo('Atrasada', 'erro');
  return selo(rotulo('situacao_pendencia', p.situacao), p.situacao === 'concluida' ? 'ok' : 'neutro');
}

function fichaPendencia(p) {
  if (!p) return h('div', {}, volta('Pendências', '#/pendencias'), h('p', { class: 'vazio' }, 'Pendência não encontrada.'));
  const alvo = p.vinculo_tipo ? { contrato: E.ix.contrato.get(p.vinculo_id), compra_direta: E.ix.compra.get(p.vinculo_id), tac: E.ix.tac.get(p.vinculo_id) }[p.vinculo_tipo] : null;
  return h('div', {}, volta('Pendências', '#/pendencias'), h('div', { class: 'ficha-topo' }, h('h2', {}, p.titulo), seloPendencia(p)),
    grupo('Dados', linhaCampo('Tipo', rotulo('tipo_pendencia', p.tipo)), linhaCampo('Descrição', p.descricao), linhaCampo('Prioridade', rotulo('prioridade_pendencia', p.prioridade)),
      linhaCampo('Prazo', d.dataBR(p.prazo)), linhaCampo('Responsável', p.responsavel), linhaCampo('Concluída em', d.dataBR(p.concluida_em)), linhaCampo('Fundo', (E.ix.fundo.get(p.fundo_id) || {}).sigla),
      alvo ? linhaCampo('Ligada a', `${p.vinculo_tipo === 'compra_direta' ? 'Compra' : p.vinculo_tipo === 'tac' ? 'TAC' : 'Contrato'} ${alvo.numero}/${alvo.ano}`) : null));
}

// ---------------------------------------------------------------------------------------------------------------- paineis e graficos
const SUBABAS = { contratos: [['painel', 'Painel'], ['lista', 'Lista']], compras: [['limites', 'Limites'], ['analise', 'Análise'], ['lista', 'Compras']], tac: [['painel', 'Painel'], ['lista', 'Lista']],
  administracao: [['usuarios', 'Usuários'], ['auditoria', 'Auditoria'], ['parametros', 'Parâmetros']] };
const qtd = (x) => String(x);
const bloco = (titulo, ...conteudo) => h('section', { class: 'grupo' }, h('h3', {}, titulo), conteudo);
const entrada = (x) => ({ ...x, valor: x.valor_centavos });
const seloNivel = (nivel) => ({ ok: () => selo('Dentro do limite', 'ok'), atencao: () => selo('Atenção', 'atencao'), critico: () => selo('Crítico', 'erro'), estourado: () => selo('Estourado', 'erro'), sem_limite: () => selo('Sem limite', 'neutro') })[nivel]();

function subabas(aba) {
  const opcoes = (SUBABAS[aba] || []).filter(([k]) => !(aba === 'compras' && k === 'limites' && !E.todosFundos));
  if (!opcoes.length) return null;
  return h('div', { class: 'subabas', role: 'tablist' }, opcoes.map(([k, nome]) => h('button', { type: 'button', role: 'tab', class: 'subaba', 'aria-selected': String(E.sub[aba] === k),
    onclick: () => { E.sub[aba] = k; E.busca = ''; if (k !== 'lista') E.filtroIds = null; desenhar(); } }, nome)));
}

function filtrarPor(aba, ids, nome) {
  E.filtroIds = { aba, ids, rotulo: nome };
  E.sub[aba] = 'lista';
  E.busca = '';
  desenhar();
}

function painelContratosView() {
  const P = pn.painelContratos(E.dados, E.hoje);
  const t = P.totais;
  const ir = (x) => filtrarPor('contratos', x.contratos, x.rotulo);
  const ids = (situacao) => P.contratos.filter((c) => c.situacao === 'vigente' && c.estado === situacao).map((c) => c.id);
  return h('div', {},
    h('div', { class: 'kpis' },
      g.kpi('Vigentes', qtd(t.vigentes), d.reais(t.valor_vigente_centavos), () => filtrarPor('contratos', P.contratos.filter((c) => c.situacao === 'vigente').map((c) => c.id), 'Vigentes')),
      g.kpi('A vencer', qtd(t.a_vencer), '', () => filtrarPor('contratos', ids('a_vencer'), 'A vencer')),
      g.kpi('Vencidos', qtd(t.vencidos), '', () => filtrarPor('contratos', ids('vencido'), 'Vencidos')),
      g.kpi('Vigência a definir', qtd(t.a_definir), '', () => filtrarPor('contratos', ids('a_definir'), 'A definir'))),
    bloco('Vencimentos (contratos por mês)', g.colunas(P.por_vencimento, { formato: qtd, campo: 'quantidade', aoClicar: ir, descricao: 'Contratos vigentes por mês de vencimento' })),
    bloco('Valor por fornecedor', g.barras(g.principaisEOutros(P.por_fornecedor, 8, 'valor_centavos', 'contratos'), { formato: d.reais, campo: 'valor_centavos', aoClicar: ir })),
    bloco('Valor por origem', g.rosca(P.por_origem.map(entrada), { formato: d.reais, aoClicar: ir, descricao: 'Valor dos contratos vigentes por origem' })),
    bloco('Valor por fundo', g.rosca(P.por_fundo.map(entrada), { formato: d.reais, aoClicar: ir, descricao: 'Valor dos contratos vigentes por fundo' })),
    bloco('Situação (todos os contratos)', g.rosca(P.por_situacao.map(entrada), { formato: d.reais, aoClicar: ir, descricao: 'Valor dos contratos por situação' })));
}

function painelTacView() {
  const P = pn.painelTac(E.dados);
  const t = P.totais;
  const ir = (x) => filtrarPor('tac', x.tacs, x.rotulo);
  return h('div', {},
    h('div', { class: 'kpis' }, g.kpi('Termos', qtd(t.termos), `${t.cancelados} cancelado(s)`), g.kpi('Reconhecido', d.reais(t.reconhecido_centavos)), g.kpi('Pago', d.reais(t.pago_centavos)), g.kpi('A pagar', d.reais(t.a_pagar_centavos))),
    bloco('Situação (valor reconhecido)', g.rosca(P.por_situacao.map(entrada), { formato: d.reais, aoClicar: ir, descricao: 'Valor dos TAC por situação' })),
    bloco('Por devedor (reconhecido)', g.barras(g.principaisEOutros(P.por_devedor, 8, 'reconhecido_centavos', 'tacs'), { formato: d.reais, campo: 'reconhecido_centavos', aoClicar: ir })),
    bloco('Por credor (reconhecido)', g.barras(g.principaisEOutros(P.por_credor, 8, 'reconhecido_centavos', 'tacs'), { formato: d.reais, campo: 'reconhecido_centavos', aoClicar: ir })),
    bloco('Assinaturas por mês (valor)', g.colunas(P.por_mes, { formato: d.reaisCompacto, campo: 'valor_centavos', aoClicar: ir, descricao: 'Valor dos TAC por mês de assinatura' })));
}

const seletor = (nome, valores, atual, aoMudar) => h('select', { class: 'seletor', 'aria-label': nome, onchange: (ev) => aoMudar(ev.target.value) }, valores.map(([v, rot]) => h('option', { value: v, selected: String(v) === String(atual) }, rot)));

function cartaoNatureza(x) {
  return h('div', { class: 'natureza grupo' }, h('div', { class: 'linha' }, h('strong', {}, x.rotulo), seloNivel(x.nivel)), g.medidor(x.percentual, x.nivel),
    h('div', { class: 'nat-numeros' }, h('span', {}, `Usado ${d.reais(x.usado_centavos)}`), h('span', {}, x.limite_centavos === null ? 'Sem limite cadastrado' : `Limite ${d.reais(x.limite_centavos)}`),
      x.saldo_centavos === null ? null : h('span', {}, `Saldo ${d.reais(x.saldo_centavos)}`), h('span', {}, g.pct(x.percentual))));
}

function limitesView() {
  const atual = Number(E.hoje.slice(0, 4));
  const anos = pn.painelLimites(E.dados, atual, null).anos_disponiveis;
  const ano = E.anoLimites !== null && anos.includes(E.anoLimites) ? E.anoLimites : (anos.includes(atual) ? atual : anos[0] ?? atual);
  const L = pn.painelLimites(E.dados, ano, E.unidade || null);
  const t = L.totais;
  return h('div', {},
    h('div', { class: 'seletores' }, seletor('Ano', anos.map((a) => [a, String(a)]), ano, (v) => { E.anoLimites = Number(v); desenhar(); }),
      seletor('Unidade gestora', [['', 'Todas as unidades'], ...L.unidades_gestoras.map((u) => [u, u])], E.unidade || '', (v) => { E.unidade = v || null; desenhar(); })),
    h('div', { class: 'kpis' }, g.kpi('Usado no ano', d.reais(t.usado_centavos), `${t.compras} compra(s), ${t.itens} item(ns)`), g.kpi('Em atenção', qtd(t.naturezas_em_atencao)), g.kpi('Críticas', qtd(t.naturezas_criticas)), g.kpi('Estouradas', qtd(t.naturezas_estouradas))),
    L.limites_cadastrados ? null : h('p', { class: 'vazio' }, 'Limite não cadastrado para este ano.'),
    L.naturezas.map(cartaoNatureza),
    L.sem_natureza.itens ? h('div', { class: 'natureza grupo' }, h('div', { class: 'linha' }, h('strong', {}, 'Sem natureza'), selo('Classificar', 'atencao')), h('div', { class: 'nat-numeros' }, h('span', {}, `Usado ${d.reais(L.sem_natureza.usado_centavos)}`), h('span', {}, `${L.sem_natureza.itens} item(ns)`))) : null);
}

function analiseComprasView() {
  const todas = pn.painelCompras(E.dados, Number(E.hoje.slice(0, 4)));
  const anos = todas.anos.length ? todas.anos : [Number(E.hoje.slice(0, 4))];
  const ano = E.anoCompras !== null && anos.includes(E.anoCompras) ? E.anoCompras : anos[0];
  const P = pn.painelCompras(E.dados, ano);
  const t = P.totais;
  const ir = (x) => filtrarPor('compras', x.compras, x.rotulo);
  return h('div', {},
    h('div', { class: 'seletores' }, seletor('Ano', anos.map((a) => [a, String(a)]), ano, (v) => { E.anoCompras = Number(v); desenhar(); })),
    h('div', { class: 'kpis' }, g.kpi('Compras', qtd(t.compras)), g.kpi('Valor', d.reais(t.valor_centavos)), g.kpi('Fornecedores', qtd(t.fornecedores)), g.kpi('Itens', qtd(t.itens))),
    bloco('Gasto por mês', g.colunas(P.por_mes, { formato: d.reaisCompacto, campo: 'valor_centavos', aoClicar: ir, descricao: 'Valor das compras diretas por mês' })),
    bloco('Por natureza', g.rosca(P.por_natureza.map(entrada), { formato: d.reais, aoClicar: ir, descricao: 'Valor dos itens por natureza' })),
    bloco('Por fornecedor', g.barras(g.principaisEOutros(P.por_fornecedor, 8, 'valor_centavos', 'compras'), { formato: d.reais, campo: 'valor_centavos', aoClicar: ir })),
    bloco('Por unidade gestora', g.barras(g.principaisEOutros(P.por_unidade, 8, 'valor_centavos', 'compras'), { formato: d.reais, campo: 'valor_centavos', aoClicar: ir })));
}

function blocosDoPainel() {
  const blocos = [];
  if (E.modulos.has('contratos')) {
    const P = pn.painelContratos(E.dados, E.hoje);
    blocos.push(bloco('Vencimentos (contratos por mês)', g.colunas(P.por_vencimento, { formato: qtd, campo: 'quantidade', aoClicar: (x) => filtrarPor('contratos', x.contratos, x.rotulo), descricao: 'Contratos vigentes por mês de vencimento' })));
  }
  if (E.modulos.has('compras') && E.todosFundos) {
    const L = pn.painelLimites(E.dados, Number(E.hoje.slice(0, 4)));
    const alerta = L.naturezas.filter((x) => ['atencao', 'critico', 'estourado'].includes(x.nivel));
    blocos.push(bloco(`Limites das compras em alerta (${L.ano})`, alerta.length ? alerta.map(cartaoNatureza) : h('p', { class: 'vazio' }, 'Nenhuma natureza em alerta.')));
  }
  return blocos;
}

// ---------------------------------------------------------------------------------------------------------------- numeracao (so consulta: quem usa o numero e o DTAF)
function textoDoNumero(s, n) {
  const det = s.detalhes[String(n)];
  if (!s.usados.includes(n)) return `Nº ${n}/${s.ano}: livre`;
  if (det && det.origem === 'cadastro') return `Nº ${n}/${s.ano}: já cadastrado no módulo TAC`;
  if (det && det.origem === 'manual') return `Nº ${n}/${s.ano}: usado por ${det.por || 'outra pessoa'} em ${d.instanteBR(det.em)}`;
  return `Nº ${n}/${s.ano}: marcado na configuração inicial`;
}

function viewNumeracao() {
  if (!E.modulos.has('numeracao')) return bloqueado();
  const anoAtual = Number(E.hoje.slice(0, 4));
  const N = E.num;
  const anos = pn.anosNumeracao(E.dados, N.tipo, [anoAtual]);
  const ano = N.ano !== null && anos.includes(N.ano) ? N.ano : anoAtual;
  const resumo = pn.resumoNumeracao(E.dados, ano);
  const s = pn.situacaoNumeracao(E.dados, N.tipo, ano, anoAtual);
  const faixas = Math.ceil(s.limite / 100);
  const faixa = Math.min(N.faixa !== null ? N.faixa : (s.proximo === null ? 0 : Math.floor((s.proximo - 1) / 100)), faixas - 1);
  const usados = new Set(s.usados);
  const detalhe = h('p', { class: 'num-detalhe', role: 'status' }, 'Toque num número usado para ver quem o usou.');
  const celulas = [];
  for (let n = faixa * 100 + 1; n <= Math.min(s.limite, (faixa + 1) * 100); n++) {
    const estado = n === s.proximo ? 'proximo' : usados.has(n) ? 'usado' : 'livre';
    celulas.push(h('button', { type: 'button', class: `num-celula ${estado}`, 'aria-label': `Número ${n}: ${estado === 'proximo' ? 'próximo disponível' : estado}`, onclick: () => { detalhe.textContent = textoDoNumero(s, n); } }, String(n)));
  }
  const mudar = (campo, valor) => { E.num[campo] = valor; if (campo !== 'faixa') E.num.faixa = null; desenhar(); };
  setTimeout(() => { const ativa = document.querySelector('.faixas .chip[aria-pressed="true"]'); if (ativa) ativa.scrollIntoView({ inline: 'center', block: 'nearest' }); }, 0); // a faixa ativa aparece na linha de botoes
  return h('div', {},
    h('div', { class: 'subabas', role: 'tablist' }, resumo.map((r) => h('button', { type: 'button', role: 'tab', class: 'subaba', 'aria-selected': String(r.tipo === N.tipo), onclick: () => mudar('tipo', r.tipo) },
      `${r.rotulo} · ${r.proximo === null ? 'completo' : `nº ${r.proximo}`}`))),
    h('div', { class: 'seletores' }, seletor('Ano', anos.map((a) => [a, String(a)]), ano, (v) => mudar('ano', Number(v)))),
    h('div', { class: 'num-proximo grupo' }, h('span', { class: 'kpi-nome' }, `Próximo disponível · ${s.rotulo} ${ano}`), h('span', { class: 'num-grande' }, s.proximo === null ? 'Completo' : String(s.proximo)),
      h('span', { class: 'kpi-apoio' }, `${s.quantidade_usada} usado(s) · ${s.livres} livre(s) · até ${s.limite}`)),
    h('div', { class: 'faixas' }, Array.from({ length: faixas }, (_x, i) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(i === faixa), onclick: () => mudar('faixa', i) }, `${i * 100 + 1}–${Math.min(s.limite, (i + 1) * 100)}`))),
    h('div', { class: 'num-grade' }, celulas),
    h('div', { class: 'num-legenda' }, h('span', { class: 'chave num-celula livre' }), 'Livre', h('span', { class: 'chave num-celula usado' }), 'Usado', h('span', { class: 'chave num-celula proximo' }), 'Próximo disponível'),
    detalhe);
}

// ---------------------------------------------------------------------------------------------------------------- administracao (usuarios e acessos, auditoria, parametros), so consulta
const COMUNS = ['ver', 'criar', 'editar', 'arquivar', 'conferir', 'exportar'];
const MATRIZ = [['painel', 'Painel', ['ver']], ['contratos', 'Contratos', COMUNS], ['compras', 'Compras diretas', COMUNS], ['tac', 'TAC', COMUNS], ['fundos', 'Fundos', COMUNS],
  ['pendencias', 'Pendências', COMUNS], ['numeracao', 'Numeração', ['ver', 'criar', 'editar', 'arquivar']], ['relatorios', 'Relatórios', ['ver', 'exportar']], ['administracao', 'Administração', ['ver', 'administrar']]];
const ROTULO_ACAO = { ver: 'Ver', criar: 'Criar', editar: 'Editar', arquivar: 'Arquivar', conferir: 'Conferir', exportar: 'Exportar', administrar: 'Administrar' };
const ROTULO_MODULO = Object.fromEntries(MATRIZ.map(([k, nome]) => [k, nome]));
const ROTULO_AUDITORIA = { login: 'Entrou', redefinir_senha_por_link: 'Definiu a senha por link', aceitar_convite: 'Primeiro acesso concluído', gerar_convite: 'Link de acesso gerado', definir_acesso: 'Acesso alterado',
  pre_cadastrar: 'Pré-cadastro', criar: 'Criou', editar: 'Editou', arquivar: 'Arquivou', conferir: 'Conferiu', carga: 'Carga de dados', marcar: 'Usou número', liberar: 'Liberou número', marcar_ate: 'Marcou números até', desligar: 'Desligou o sistema' };
const rotuloAcao = (a) => ROTULO_AUDITORIA[a] || a.replace(/_/g, ' ');

function viewAdministracao() {
  if (!E.modulos.has('administracao')) return bloqueado();
  const sub = E.sub.administracao;
  return h('div', {}, subabas('administracao'), E.detalhe && sub === 'usuarios' ? fichaUsuario(E.dados.usuario.find((u) => u.id === Number(E.detalhe))) : sub === 'auditoria' ? auditoriaView() : sub === 'parametros' ? parametrosView() : usuariosView());
}

function usuariosView() {
  const permitidos = (u) => E.dados.permissao.filter((p) => p.usuario_id === u.id && p.acao === 'ver').length;
  return h('div', { class: 'lista' }, [...E.dados.usuario].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map((u) => botaoCartao(
    cartao(u.nome, selo(u.ativo === 1 ? 'Ativo' : 'Inativo', u.ativo === 1 ? 'ok' : 'neutro'), h('div', { class: 'suave' }, u.email),
      h('div', { class: 'linha pequena' }, h('span', {}, u.todos_fundos === 1 ? 'Todos os fundos' : `${E.dados.usuario_fundo.filter((x) => x.usuario_id === u.id).length} fundo(s)`), h('span', {}, `${permitidos(u)} módulo(s)`))),
    () => ir(`#/administracao/${u.id}`))));
}

function fichaUsuario(u) {
  if (!u) return h('div', {}, volta('Usuários', '#/administracao'), h('p', { class: 'vazio' }, 'Usuário não encontrado.'));
  const tem = new Set(E.dados.permissao.filter((p) => p.usuario_id === u.id).map((p) => `${p.modulo}/${p.acao}`));
  const fundos = u.todos_fundos === 1 ? 'Todos os fundos' : E.dados.usuario_fundo.filter((x) => x.usuario_id === u.id).map((x) => (E.ix.fundo.get(x.fundo_id) || {}).sigla || (E.ix.fundo.get(x.fundo_id) || {}).nome).filter(Boolean).join(', ') || 'Nenhum';
  const acoes = Object.keys(ROTULO_ACAO);
  return h('div', {}, volta('Usuários', '#/administracao'), h('div', { class: 'ficha-topo' }, h('h2', {}, u.nome), selo(u.ativo === 1 ? 'Ativo' : 'Inativo', u.ativo === 1 ? 'ok' : 'neutro')),
    grupo('Dados', linhaCampo('E-mail', u.email), linhaCampo('Fundos', fundos), linhaCampo('Último acesso', d.instanteBR(u.ultimo_acesso))),
    h('section', { class: 'grupo' }, h('h3', {}, 'Acessos (só consulta)'), h('div', { class: 'matriz-rolagem' }, h('table', { class: 'matriz' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Módulo'), acoes.map((a) => h('th', {}, ROTULO_ACAO[a])))),
      h('tbody', {}, MATRIZ.map(([modulo, nome, doModulo]) => h('tr', {}, h('th', { scope: 'row' }, nome),
        acoes.map((a) => h('td', { class: doModulo.includes(a) ? (tem.has(`${modulo}/${a}`) ? 'sim' : 'nao') : 'na', 'aria-label': doModulo.includes(a) ? (tem.has(`${modulo}/${a}`) ? 'Tem' : 'Não tem') : 'Não se aplica' },
          doModulo.includes(a) ? (tem.has(`${modulo}/${a}`) ? '✓' : '–') : '')))))))));
}

function auditoriaView() {
  const A = E.auditoria;
  const nome = new Map(E.dados.usuario.map((u) => [u.id, u.nome]));
  const modulos = [...new Set(E.dados.auditoria.map((a) => a.modulo))].sort();
  const lista = h('div', { class: 'lista' });
  const contador = h('p', { class: 'contador', role: 'status' });
  const pintar = () => {
    const q = d.normalizar(A.busca);
    const todas = [...E.dados.auditoria].sort((a, b) => b.id - a.id).filter((x) => (!A.modulo || x.modulo === A.modulo)
      && (!q || d.normalizar(`${x.acao} ${x.entidade} ${x.usuario_email} ${nome.get(x.usuario_id) || ''} ${x.depois || ''}`).includes(q)));
    contador.textContent = `${todas.length} registro(s)`;
    trocar(lista, todas.slice(0, A.limite).map((x) => {
      const antes = x.antes ? textoJson(x.antes) : null; const depois = x.depois ? textoJson(x.depois) : null;
      return h('details', { class: 'auditoria-item cartao' }, h('summary', {}, h('div', { class: 'linha' }, h('strong', {}, rotuloAcao(x.acao)), h('span', { class: 'suave pequena' }, d.instanteBR(x.quando))),
        h('div', { class: 'suave pequena' }, `${nome.get(x.usuario_id) || x.usuario_email || 'Sistema'} · ${ROTULO_MODULO[x.modulo] || x.modulo} · ${x.entidade}${x.entidade_id ? ` #${x.entidade_id}` : ''} · origem ${x.origem}`)),
      antes ? h('div', {}, h('div', { class: 'suave pequena' }, 'Antes'), h('pre', { class: 'json' }, antes)) : null, depois ? h('div', {}, h('div', { class: 'suave pequena' }, 'Depois'), h('pre', { class: 'json' }, depois)) : null);
    }), todas.length > A.limite ? h('button', { type: 'button', class: 'secundario', onclick: () => { A.limite += 100; pintar(); } }, 'Mostrar mais') : null);
  };
  const campo = h('input', { class: 'busca', type: 'search', placeholder: 'Buscar', 'aria-label': 'Buscar na auditoria', value: A.busca, oninput: (ev) => { A.busca = ev.target.value; A.limite = 100; pintar(); } });
  pintar();
  return h('div', {}, h('div', { class: 'seletores' }, seletor('Módulo', [['', 'Todos os módulos'], ...modulos.map((m) => [m, ROTULO_MODULO[m] || m])], A.modulo, (v) => { A.modulo = v; A.limite = 100; desenhar(); })), campo, contador, lista);
}

function textoJson(texto) {
  try { return JSON.stringify(JSON.parse(texto), null, 1); } catch (e) { return texto; }
}

function parametrosView() {
  const porGrupo = new Map();
  for (const p of E.dados.parametro) { if (!porGrupo.has(p.grupo)) porGrupo.set(p.grupo, []); porGrupo.get(p.grupo).push(p); }
  const limites = [...E.dados.limite_legal].sort((a, b) => b.ano - a.ano || cmpTexto(a.tipo, b.tipo));
  return h('div', {},
    [...porGrupo.entries()].sort(([a], [b]) => cmpTexto(a, b)).map(([grupoNome, itens]) => grupo(grupoNome, itens.sort((a, b) => cmpTexto(a.chave, b.chave)).map((p) => linhaCampo(p.chave, p.valor)))),
    grupo('Limites legais (art. 75)', limites.map((l) => linhaCampo(`${l.ano} · ${l.tipo}`, `${d.reais(l.valor_centavos)} (${l.fonte}, ${l.grau})`))),
    grupo('Calendário (dias sem expediente)', [...E.dados.calendario_dia].sort((a, b) => cmpTexto(a.data, b.data)).map((c) => linhaCampo(d.dataBR(c.data), `${c.motivo}${c.fonte ? ` (${c.fonte})` : ''}`))),
    E.dados.calendario_dia.length ? null : h('p', { class: 'vazio' }, 'Nenhum dia cadastrado no calendário.'));
}

const cmpTexto = (x, y) => (x < y ? -1 : x > y ? 1 : 0);

// ---------------------------------------------------------------------------------------------------------------- trocar a propria senha
function viewSenha() {
  const campo = (id, nome, auto) => [h('label', { for: id }, nome), h('input', { id, name: id, type: 'password', autocomplete: auto, required: true })];
  const erro = h('p', { class: 'erro', role: 'alert' });
  const pronto = h('p', { class: 'sucesso', role: 'status' });
  const botao = h('button', { type: 'submit', class: 'primario' }, 'Salvar');
  const form = h('form', { class: 'login formulario', onsubmit: async (ev) => {
    ev.preventDefault();
    erro.textContent = '';
    pronto.textContent = '';
    const [atual, nova, confirma] = ['senha-atual', 'senha-nova', 'senha-confirma'].map((i) => form.querySelector(`#${i}`).value);
    const problema = d.problemaDeSenha(nova) || (nova !== confirma ? 'A confirmação não confere com a nova senha.' : '') || (nova === atual ? 'A nova senha precisa ser diferente da atual.' : '');
    if (problema) { erro.textContent = problema; return; }
    botao.disabled = true;
    try {
      await trocarSenha(atual, nova);
      form.reset();
      pronto.textContent = 'Senha alterada.';
    } catch (e) {
      const t = e instanceof ErroNuvem ? e.tipo : '';
      if (t === 'sessao') { await deslogar(); return; }
      erro.textContent = { senha_atual: 'Senha atual incorreta.', senha_fraca: 'Senha fraca. Use 12 caracteres ou mais, com maiúsculas, minúsculas e números.',
        senha_igual: 'A nova senha precisa ser diferente da atual.', rede: 'Sem conexão.' }[t] || 'Não foi possível trocar a senha. Tente de novo.';
    } finally {
      botao.disabled = false;
    }
  } }, campo('senha-atual', 'Senha atual', 'current-password'), campo('senha-nova', 'Nova senha', 'new-password'), campo('senha-confirma', 'Confirmar a nova senha', 'new-password'), erro, pronto, botao);
  return h('div', {}, volta('Voltar', '#/painel'), h('div', { class: 'ficha-topo' }, h('h2', {}, 'Trocar senha')), form);
}

// ---------------------------------------------------------------------------------------------------------------- estrutura da pagina
const VIEWS = { painel: () => h('div', {}, viewPainel(), blocosDoPainel()), contratos: viewContratos, compras: viewCompras, tac: viewTac, fundos: viewFundos, pendencias: viewPendencias, numeracao: viewNumeracao, administracao: viewAdministracao };

function trocarTema() {
  const atual = document.documentElement.dataset.tema || (matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro');
  const novo = atual === 'escuro' ? 'claro' : 'escuro';
  document.documentElement.dataset.tema = novo;
  try { localStorage.setItem('dtaf.tema', novo); } catch (e) { /* sem armazenamento: vale so agora */ }
}

function desenhar() {
  lerHash();
  if (E.abaAnterior !== E.aba) {
    E.filtroIds = null; // o filtro do grafico tambem vale so na aba em que foi feito
    E.busca = ''; // a busca vale so dentro da aba em que foi digitada
    E.abaAnterior = E.aba;
  }
  const meta = E.dados.espelho_meta[0];
  const horas = meta ? d.horasDesde(meta.gerado_em) : null;
  const abas = ABAS.filter(([k]) => E.modulos.has(k));
  if (!abas.some(([k]) => k === E.aba)) E.aba = abas.length ? abas[0][0] : 'painel';
  const conteudo = h('main', { id: 'conteudo', class: 'conteudo' }, E.senha ? viewSenha() : VIEWS[E.aba]());
  trocar(raiz,
    h('header', { class: 'topo' },
      h('img', { src: 'img/brasao.png', alt: '', class: 'brasao', width: '32', height: '32' }),
      h('div', { class: 'titulo' }, h('strong', {}, 'DTAF'), h('span', { class: 'sub' }, meta ? `Espelho de ${d.instanteBR(meta.gerado_em)}` : 'Sem espelho'), horas !== null && horas > 48 ? selo('Desatualizado', 'atencao') : null),
      h('div', { class: 'acoes' },
        h('button', { type: 'button', class: 'botao-topo', onclick: atualizar }, 'Atualizar'),
        h('button', { type: 'button', class: 'botao-topo', onclick: trocarTema }, 'Tema'),
        h('button', { type: 'button', class: 'botao-topo', onclick: () => ir('#/senha') }, 'Senha'),
        h('button', { type: 'button', class: 'botao-topo', onclick: deslogar }, 'Sair'))),
    h('nav', { class: 'abas', role: 'tablist' }, abas.map(([k, nome]) => h('button', { type: 'button', role: 'tab', class: 'aba', 'aria-selected': String(k === E.aba), onclick: () => { E.busca = ''; ir(`#/${k}`); } }, nome))),
    conteudo);
  if (!E.detalhe) window.scrollTo(0, 0);
}

function telaMensagem(texto, ...botoes) {
  trocar(raiz, h('div', { class: 'centro' }, h('img', { src: 'img/brasao.png', alt: '', class: 'brasao-grande', width: '96', height: '96' }), h('p', { role: 'status' }, texto), botoes));
}

async function atualizar() {
  telaMensagem('Atualizando…');
  await iniciarComSessao();
}

async function deslogar() {
  await sair();
  E.dados = null;
  location.hash = '';
  telaLogin();
}

function telaLogin(erro) {
  const email = h('input', { id: 'email', name: 'email', type: 'email', autocomplete: 'username', required: true, inputmode: 'email', autocapitalize: 'none' });
  const senha = h('input', { id: 'senha', name: 'senha', type: 'password', autocomplete: 'current-password', required: true });
  const mensagem = h('p', { class: 'erro', role: 'alert' }, erro || '');
  const botao = h('button', { type: 'submit', class: 'primario' }, 'Entrar');
  const form = h('form', { class: 'login', onsubmit: async (ev) => {
    ev.preventDefault();
    botao.disabled = true;
    mensagem.textContent = '';
    try {
      await entrar(email.value.trim(), senha.value);
      senha.value = '';
      await iniciarComSessao();
    } catch (e) {
      botao.disabled = false;
      senha.value = '';
      mensagem.textContent = e instanceof ErroNuvem && e.tipo === 'credenciais' ? 'E-mail ou senha incorretos.' : e instanceof ErroNuvem && e.tipo === 'rede' ? 'Sem conexão.' : 'Não foi possível entrar. Tente de novo.';
    }
  } },
  h('label', { for: 'email' }, 'E-mail'), email, h('label', { for: 'senha' }, 'Senha'), senha, mensagem, botao);
  trocar(raiz, h('div', { class: 'centro' }, h('img', { src: 'img/brasao.png', alt: '', class: 'brasao-grande', width: '96', height: '96' }), h('h1', {}, 'DTAF'), form));
}

async function iniciarComSessao() {
  try {
    await carregar();
  } catch (e) {
    if (e instanceof ErroNuvem && e.tipo === 'sessao') return telaLogin();
    return telaMensagem(e instanceof ErroNuvem && e.tipo === 'rede' ? 'Sem conexão.' : 'Não foi possível carregar.', h('button', { type: 'button', class: 'primario', onclick: atualizar }, 'Tentar de novo'), h('button', { type: 'button', class: 'secundario', onclick: deslogar }, 'Sair'));
  }
  if (E.eu === null) return telaMensagem('Seu e-mail não está liberado.', h('button', { type: 'button', class: 'secundario', onclick: deslogar }, 'Sair'));
  desenhar();
}

window.addEventListener('hashchange', () => { if (E.dados) desenhar(); });

if (carregarSessao()) {
  telaMensagem('Carregando…');
  iniciarComSessao();
} else {
  telaLogin();
}
