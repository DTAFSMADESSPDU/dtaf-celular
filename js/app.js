// Aplicativo do celular do DTAF: so visualiza o espelho que o computador servidor envia (D03, D53). Nenhum texto vira HTML (a tela
// e montada por elementos e textContent), sem avaliar codigo, sem biblioteca externa. Cada pessoa ve so o que o modulo e os fundos
// dela permitem: quem decide e o banco (RLS), nao esta tela.
import { carregarSessao, entrar, sair, lerTabela, ErroNuvem } from './nuvem.js';
import * as d from './dados.js';

const raiz = document.getElementById('raiz');
const ABAS = [['painel', 'Painel'], ['contratos', 'Contratos'], ['compras', 'Compras diretas'], ['tac', 'TAC'], ['fundos', 'Fundos'], ['pendencias', 'Pendências']];
const TABELAS = ['espelho_meta', 'usuario', 'permissao', 'lista_valor', 'natureza_compra', 'fundo', 'fundo_conta', 'fundo_lancamento', 'fornecedor',
  'contrato', 'contrato_movimento', 'contrato_fundo', 'compra_direta', 'compra_fornecedor', 'compra_fundo', 'compra_item', 'tac', 'tac_pagamento',
  'pendencia', 'conferencia_campo'];

const E = { dados: null, ix: null, aba: 'painel', detalhe: null, busca: '', filtro: { contratos: 'todos', pendencias: 'abertas' }, hoje: d.hojeISO(), modulos: new Set() };

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
  E.modulos = new Set(E.dados.permissao.filter((p) => p.acao === 'ver').map((p) => p.modulo));
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
  const filtrar = () => {
    const q = d.normalizar(E.busca);
    const filtrados = itens().filter((x) => !q || d.normalizar(textoBusca(x)).includes(q));
    contador.textContent = `${filtrados.length} registro(s)`;
    trocar(lista, filtrados.map((x) => botaoCartao(cartaoDe(x), () => ir(`#/${aba}/${x.id}`))));
  };
  const campoBusca = h('input', { class: 'busca', type: 'search', placeholder: 'Buscar', 'aria-label': 'Buscar', value: E.busca, oninput: (ev) => { E.busca = ev.target.value; filtrar(); } });
  const faixa = chips ? h('div', { class: 'chips' }, chips(filtrar)) : null;
  filtrar();
  return h('div', {}, campoBusca, faixa, contador, lista);
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
      linhaCampo('Processo (SIGED)', c.processo_adm, cf('processo_adm')), linhaCampo('Assinatura', d.dataBR(c.data_assinatura), cf('data_assinatura')), linhaCampo('Fundos', fundos.join(', '))),
    grupo('Vigência', linhaCampo('Início', d.dataBR(k.vigencia.inicio), cf('vigencia_inicio')), linhaCampo('Prazo (meses)', c.prazo_meses, cf('prazo_meses')),
      linhaCampo('Fim', k.vigencia.fim ? `${d.dataBR(k.vigencia.fim)}${origemVig}` : 'A definir', cf('vigencia_fim_informada')),
      linhaCampo('Dias para o fim', k.alerta.dias === null ? '' : String(k.alerta.dias))),
    grupo('Valores', linhaCampo('Valor inicial', d.reais(c.valor_inicial_centavos), cf('valor_inicial_centavos')), linhaCampo('Valor atual', d.reais(k.valor))),
    k.movs.length ? h('section', { class: 'grupo' }, h('h3', {}, 'Aditivos e apostilamentos'), k.movs.sort((a, b) => (a.ordem || 0) - (b.ordem || 0)).map((m) => h('div', { class: 'subcartao' },
      h('div', { class: 'linha' }, h('strong', {}, `${m.ordem || ''}º ${rotulo('tipo_movimento', m.tipo)}`.trim()), h('span', { class: 'suave' }, d.dataBR(m.data_assinatura))),
      h('dl', {}, linhaCampo('Nova vigência', [d.dataBR(m.nova_vigencia_inicio), d.dataBR(m.nova_vigencia_fim)].filter(Boolean).join(' a ')), linhaCampo('Prazo (meses)', m.prazo_meses),
        linhaCampo('Variação de valor', d.reais(m.valor_variacao_centavos)), linhaCampo('Novo valor global', d.reais(m.novo_valor_global_centavos)), linhaCampo('Fundamento legal', m.fundamento_legal),
        linhaCampo('Processo (SIGED)', m.processo_adm))))) : null);
}

// ---------------------------------------------------------------------------------------------------------------- compras diretas
function viewCompras() {
  if (!E.modulos.has('compras')) return bloqueado();
  if (E.detalhe) return fichaCompra(E.ix.compra.get(Number(E.detalhe)));
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
      linhaCampo('Fundos', fundos.join(', '))),
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
      linhaCampo('Publicação', d.dataBR(t.data_publicacao))),
    grupo('Valores', linhaCampo('Valor reconhecido', d.reais(t.valor_centavos), cf('valor_centavos')), linhaCampo('Notas fiscais', d.reais(t.valor_notas_fiscais_centavos)),
      linhaCampo('Glosa', d.reais(t.valor_glosa_centavos)), linhaCampo('Ressalva', d.reais(t.valor_ressalvado_centavos)), linhaCampo('Pago', d.reais(k.pago)), linhaCampo('Saldo a pagar', d.reais(k.saldo))),
    grupo('Empenho', linhaCampo('Nota de empenho', t.nota_empenho, cf('nota_empenho')), linhaCampo('Valor', d.reais(t.valor_empenho_centavos)), linhaCampo('Data', d.dataBR(t.data_empenho)),
      linhaCampo('Dotação', t.dotacao), linhaCampo('Fonte de recurso', t.fonte_recurso)),
    pagamentos.length ? h('section', { class: 'grupo' }, h('h3', {}, 'Pagamentos'), pagamentos.map((p) => h('div', { class: 'subcartao' }, h('div', { class: 'linha' },
      h('strong', {}, p.data ? d.dataBR(p.data) : 'Sem data'), h('span', { class: 'valor' }, d.reais(p.valor_centavos))), p.referencia ? h('div', { class: 'suave pequena' }, p.referencia) : null))) : null);
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
          h('span', { class: `valor ${['entrada', 'resgate'].includes(l.tipo) ? 'entra' : 'sai'}` }, d.reais(l.valor_centavos))), l.descricao ? h('div', { class: 'suave pequena' }, l.descricao) : null)));
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
      linhaCampo('Prazo', d.dataBR(p.prazo)), linhaCampo('Concluída em', d.dataBR(p.concluida_em)), linhaCampo('Fundo', (E.ix.fundo.get(p.fundo_id) || {}).sigla),
      alvo ? linhaCampo('Ligada a', `${p.vinculo_tipo === 'compra_direta' ? 'Compra' : p.vinculo_tipo === 'tac' ? 'TAC' : 'Contrato'} ${alvo.numero}/${alvo.ano}`) : null));
}

// ---------------------------------------------------------------------------------------------------------------- estrutura da pagina
const VIEWS = { painel: viewPainel, contratos: viewContratos, compras: viewCompras, tac: viewTac, fundos: viewFundos, pendencias: viewPendencias };

function trocarTema() {
  const atual = document.documentElement.dataset.tema || (matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro');
  const novo = atual === 'escuro' ? 'claro' : 'escuro';
  document.documentElement.dataset.tema = novo;
  try { localStorage.setItem('dtaf.tema', novo); } catch (e) { /* sem armazenamento: vale so agora */ }
}

function desenhar() {
  lerHash();
  if (E.abaAnterior !== E.aba) {
    E.busca = ''; // a busca vale so dentro da aba em que foi digitada
    E.abaAnterior = E.aba;
  }
  const meta = E.dados.espelho_meta[0];
  const horas = meta ? d.horasDesde(meta.gerado_em) : null;
  const abas = ABAS.filter(([k]) => E.modulos.has(k));
  if (!abas.some(([k]) => k === E.aba)) E.aba = abas.length ? abas[0][0] : 'painel';
  const conteudo = h('main', { id: 'conteudo', class: 'conteudo' }, VIEWS[E.aba]());
  trocar(raiz,
    h('header', { class: 'topo' },
      h('img', { src: 'img/brasao.png', alt: '', class: 'brasao', width: '32', height: '32' }),
      h('div', { class: 'titulo' }, h('strong', {}, 'DTAF'), h('span', { class: 'sub' }, meta ? `Espelho de ${d.instanteBR(meta.gerado_em)}` : 'Sem espelho'), horas !== null && horas > 48 ? selo('Desatualizado', 'atencao') : null),
      h('div', { class: 'acoes' },
        h('button', { type: 'button', class: 'botao-topo', onclick: atualizar }, 'Atualizar'),
        h('button', { type: 'button', class: 'botao-topo', onclick: trocarTema }, 'Tema'),
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
  if (E.dados.usuario.length === 0) return telaMensagem('Seu e-mail não está liberado.', h('button', { type: 'button', class: 'secundario', onclick: deslogar }, 'Sair'));
  desenhar();
}

window.addEventListener('hashchange', () => { if (E.dados) desenhar(); });

if (carregarSessao()) {
  telaMensagem('Carregando…');
  iniciarComSessao();
} else {
  telaLogin();
}
