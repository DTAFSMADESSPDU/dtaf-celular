// Numeros dos paineis do celular: reproduzem app/paineis.py, app/painel.py e app/limites_compras.py a partir do ESPELHO (as mesmas tabelas que o
// computador envia). Funcoes puras. A prova de equivalencia e celular/testes.html (casos gerados pelo Python sobre o mesmo banco sintetico).
import * as d from './dados.js';

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_A_FRENTE = 18;
const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);

export const rotuloMes = (chave) => { const [a, m] = chave.split('-'); return `${MESES[Number(m) - 1]}/${a}`; };

function mesesAFrente(hoje, quantidade) {
  let [ano, mes] = hoje.split('-').map(Number);
  const saida = [];
  for (let i = 0; i < quantidade; i++) {
    saida.push(`${ano}-${String(mes).padStart(2, '0')}`);
    if (mes === 12) { ano += 1; mes = 1; } else mes += 1;
  }
  return saida;
}

function somar(grupos, chave, rotulo, campoIds, id, somas) {
  let g = grupos.get(chave);
  if (!g) {
    g = { chave, rotulo, quantidade: 0, [campoIds]: [], ...Object.fromEntries(Object.keys(somas).map((k) => [k, 0])) };
    grupos.set(chave, g);
  }
  g.quantidade += 1;
  g[campoIds].push(id);
  for (const [k, v] of Object.entries(somas)) g[k] += v;
}

const porValor = (grupos, campo) => [...grupos.values()].sort((a, b) => (b[campo] - a[campo]) || cmp(a.rotulo, b.rotulo));

/** round(x, 1) do Python (arredonda o valor binario exato; empate exato vai para o par). */
export function arredondar1(x) {
  const f = x * 10;
  if (Number.isInteger(f * 2) && !Number.isInteger(f)) {
    const m = Math.floor(f);
    return (m % 2 === 0 ? m : m + 1) / 10;
  }
  return Number(x.toFixed(1));
}

// ----------------------------------------------------------------------------------------------------------------- indices do espelho
const agrupar = (linhas, chave) => { const m = new Map(); for (const x of linhas) { if (!m.has(x[chave])) m.set(x[chave], []); m.get(x[chave]).push(x); } return m; };
const rotulos = (D, lista) => D.lista_valor.filter((l) => l.lista === lista && l.ativo === 1).sort((a, b) => a.ordem - b.ordem).map((l) => [l.codigo, l.rotulo]);

/** Lista de contratos como app/contratos.py listar_contratos entrega (so o que os paineis usam). */
export function listaContratos(D, hoje) {
  const forn = new Map(D.fornecedor.map((f) => [f.id, f.razao_social]));
  const fundos = new Map(D.fundo.map((f) => [f.id, f.nome]));
  const movs = agrupar(D.contrato_movimento, 'contrato_id');
  const cfs = agrupar(D.contrato_fundo, 'contrato_id');
  return D.contrato.map((c) => {
    const m = movs.get(c.id) || [];
    const vigencia = d.calcularVigencia(c, m);
    return {
      id: c.id, numero: c.numero, ano: c.ano, fornecedor: forn.get(c.fornecedor_id) || null, objeto: c.objeto, situacao: c.situacao, origem: c.origem,
      data_assinatura: c.data_assinatura, prazo_meses: c.prazo_meses, valor_atual_centavos: d.valorAtual(c, m),
      fundos: (cfs.get(c.id) || []).map((x) => fundos.get(x.fundo_id)).filter((n) => n !== undefined).sort(),
      vigencia, alerta: d.alerta(vigencia.fim, hoje),
    };
  });
}

export function listaTacs(D) {
  const forn = new Map(D.fornecedor.map((f) => [f.id, f.razao_social]));
  const fundos = new Map(D.fundo.map((f) => [f.id, f.nome]));
  const pags = agrupar(D.tac_pagamento, 'tac_id');
  return D.tac.map((t) => {
    const k = d.saldoTac(t, pags.get(t.id) || []);
    return { id: t.id, numero: t.numero, ano: t.ano, devedor: t.devedor, fundo: fundos.get(t.fundo_id) || null, credor: forn.get(t.credor_id) || null, situacao: t.situacao,
      data_assinatura: t.data_assinatura, valor_centavos: t.valor_centavos, pago_centavos: k.pago, saldo_centavos: t.valor_centavos - k.pago };
  });
}

export const anoFiscal = (c) => (c.data_publicacao ? Number(c.data_publicacao.slice(0, 4)) : c.ano);

// ----------------------------------------------------------------------------------------------------------------- contratos
export function painelContratos(D, hoje) {
  const lista = listaContratos(D, hoje);
  const origens = new Map(rotulos(D, 'origem_contrato'));
  const situacoes = rotulos(D, 'situacao_contrato');
  const vigentes = lista.filter((c) => c.situacao === 'vigente');
  const valor = (c) => c.valor_atual_centavos || 0;
  const estado = (c) => (c.situacao === 'vigente' ? c.alerta.situacao : c.situacao);

  const meses = mesesAFrente(hoje, MESES_A_FRENTE);
  const vencimento = new Map([['vencidos', { chave: 'vencidos', rotulo: 'Vencidos' }]]);
  for (const m of meses) vencimento.set(m, { chave: m, rotulo: rotuloMes(m) });
  vencimento.set('depois', { chave: 'depois', rotulo: 'Depois' });
  vencimento.set('a_definir', { chave: 'a_definir', rotulo: 'A definir' });
  for (const g of vencimento.values()) Object.assign(g, { quantidade: 0, valor_centavos: 0, contratos: [] });
  for (const c of vigentes) {
    const fim = c.vigencia.fim;
    let chave;
    if (fim === null) chave = 'a_definir';
    else if (c.alerta.situacao === 'vencido') chave = 'vencidos';
    else chave = vencimento.has(fim.slice(0, 7)) ? fim.slice(0, 7) : 'depois';
    const g = vencimento.get(chave);
    g.quantidade += 1; g.valor_centavos += valor(c); g.contratos.push(c.id);
  }

  const porFornecedor = new Map(); const porFundo = new Map(); const porOrigem = new Map(); const porSituacao = new Map();
  for (const c of vigentes) {
    const nome = c.fornecedor || 'Sem fornecedor';
    somar(porFornecedor, nome, nome, 'contratos', c.id, { valor_centavos: valor(c) });
    for (const fundo of c.fundos.length ? c.fundos : ['Sem fundo']) somar(porFundo, fundo, fundo, 'contratos', c.id, { valor_centavos: valor(c) });
    const codigo = c.origem || 'sem_origem';
    somar(porOrigem, codigo, origens.get(codigo) || 'Sem origem', 'contratos', c.id, { valor_centavos: valor(c) });
  }
  const rotSit = new Map(situacoes);
  for (const c of lista) somar(porSituacao, c.situacao, rotSit.get(c.situacao) || c.situacao, 'contratos', c.id, { valor_centavos: valor(c) });
  const ordem = new Map(situacoes.map(([codigo], i) => [codigo, i]));
  return {
    totais: { contratos: lista.length, vigentes: vigentes.length, valor_vigente_centavos: vigentes.reduce((s, c) => s + valor(c), 0),
      vencidos: vigentes.filter((c) => estado(c) === 'vencido').length, a_vencer: vigentes.filter((c) => estado(c) === 'a_vencer').length,
      a_definir: vigentes.filter((c) => estado(c) === 'a_definir').length },
    por_vencimento: [...vencimento.values()],
    por_fornecedor: porValor(porFornecedor, 'valor_centavos'), por_fundo: porValor(porFundo, 'valor_centavos'), por_origem: porValor(porOrigem, 'valor_centavos'),
    por_situacao: [...porSituacao.values()].sort((a, b) => (ordem.has(a.chave) ? ordem.get(a.chave) : ordem.size) - (ordem.has(b.chave) ? ordem.get(b.chave) : ordem.size)),
    contratos: lista.map((c) => ({ id: c.id, numero: c.numero, ano: c.ano, fornecedor: c.fornecedor, objeto: c.objeto, situacao: c.situacao, estado: estado(c), origem: c.origem,
      valor_atual_centavos: c.valor_atual_centavos, fim: c.vigencia.fim, dias: c.alerta.dias, fundos: c.fundos, data_assinatura: c.data_assinatura, prazo_meses: c.prazo_meses })),
  };
}

// ----------------------------------------------------------------------------------------------------------------- TAC
export function painelTac(D) {
  const lista = listaTacs(D);
  const situacoes = rotulos(D, 'situacao_tac');
  const vivos = lista.filter((t) => t.situacao !== 'cancelado');
  const novo = (chave, rotulo) => ({ chave, rotulo, quantidade: 0, valor_centavos: 0, a_pagar_centavos: 0, tacs: [] });
  const porSituacao = new Map(situacoes.map(([codigo, rotulo]) => [codigo, novo(codigo, rotulo)]));
  for (const t of lista) {
    if (!porSituacao.has(t.situacao)) porSituacao.set(t.situacao, novo(t.situacao, t.situacao));
    const g = porSituacao.get(t.situacao);
    g.quantidade += 1; g.valor_centavos += t.valor_centavos; g.a_pagar_centavos += t.situacao === 'cancelado' ? 0 : t.saldo_centavos; g.tacs.push(t.id);
  }
  const porDevedor = new Map(); const porCredor = new Map(); const porMes = new Map();
  for (const t of vivos) {
    const soma = { reconhecido_centavos: t.valor_centavos, pago_centavos: t.pago_centavos, a_pagar_centavos: t.saldo_centavos };
    const devedor = t.fundo || t.devedor || 'Sem devedor';
    somar(porDevedor, devedor, devedor, 'tacs', t.id, soma);
    const credor = t.credor || 'Sem credor';
    somar(porCredor, credor, credor, 'tacs', t.id, soma);
    if (t.data_assinatura) somar(porMes, t.data_assinatura.slice(0, 7), rotuloMes(t.data_assinatura.slice(0, 7)), 'tacs', t.id, { valor_centavos: t.valor_centavos });
    else somar(porMes, 'sem_data', 'Sem data', 'tacs', t.id, { valor_centavos: t.valor_centavos });
  }
  const meses = [...porMes.values()].filter((g) => g.chave !== 'sem_data').sort((a, b) => cmp(a.chave, b.chave)).concat(porMes.has('sem_data') ? [porMes.get('sem_data')] : []);
  const porRec = (m) => [...m.values()].sort((a, b) => (b.reconhecido_centavos - a.reconhecido_centavos) || cmp(a.rotulo, b.rotulo));
  return {
    totais: { termos: vivos.length, reconhecido_centavos: vivos.reduce((s, t) => s + t.valor_centavos, 0), pago_centavos: vivos.reduce((s, t) => s + t.pago_centavos, 0),
      a_pagar_centavos: vivos.reduce((s, t) => s + t.saldo_centavos, 0), cancelados: lista.length - vivos.length },
    por_situacao: [...porSituacao.values()], por_devedor: porRec(porDevedor), por_credor: porRec(porCredor), por_mes: meses, tacs: lista,
  };
}

// ----------------------------------------------------------------------------------------------------------------- compras
export function painelCompras(D, ano) {
  const forn = new Map(D.fornecedor.map((f) => [f.id, f.razao_social]));
  const nat = new Map(D.natureza_compra.map((n) => [n.codigo, n.rotulo]));
  const cfs = agrupar(D.compra_fornecedor, 'compra_id');
  const itens = agrupar(D.compra_item, 'compra_id');
  const todas = D.compra_direta;
  const anos = [...new Set(todas.map(anoFiscal))].sort((a, b) => b - a);
  const doAno = todas.filter((c) => anoFiscal(c) === ano);
  const porFornecedor = new Map(); const porNatureza = new Map(); const porUnidade = new Map();
  for (const c of [...doAno].sort((a, b) => a.id - b.id)) {
    for (const l of [...(cfs.get(c.id) || [])].sort((a, b) => a.id - b.id)) {
      const nome = forn.get(l.fornecedor_id);
      somar(porFornecedor, nome, nome, 'compras', c.id, { valor_centavos: l.valor_centavos });
    }
  }
  for (const c of [...doAno].sort((a, b) => a.id - b.id)) {
    for (const i of [...(itens.get(c.id) || [])].sort((a, b) => a.id - b.id)) {
      const chave = i.natureza || 'sem_natureza';
      if (!porNatureza.has(chave)) porNatureza.set(chave, { chave, rotulo: (i.natureza && nat.get(i.natureza)) || 'Sem natureza', quantidade: 0, itens: 0, valor_centavos: 0, compras: [] });
      const g = porNatureza.get(chave);
      g.itens += 1; g.quantidade = g.itens; g.valor_centavos += i.valor_total_centavos;
      if (!g.compras.includes(c.id)) g.compras.push(c.id);
    }
  }
  for (const c of doAno) { const u = c.unidade_gestora || 'Sem unidade'; somar(porUnidade, u, u, 'compras', c.id, { valor_centavos: c.valor_total_centavos }); }
  const porMes = new Map();
  for (let m = 1; m <= 12; m++) { const k = `${ano}-${String(m).padStart(2, '0')}`; porMes.set(k, { chave: k, rotulo: rotuloMes(k), quantidade: 0, valor_centavos: 0, compras: [] }); }
  const semData = { chave: 'sem_data', rotulo: 'Sem data', quantidade: 0, valor_centavos: 0, compras: [] };
  for (const c of doAno) {
    const g = porMes.get((c.data_publicacao || '').slice(0, 7)) || semData;
    g.quantidade += 1; g.valor_centavos += c.valor_total_centavos; g.compras.push(c.id);
  }
  const nomesForn = (c) => (cfs.get(c.id) || []).map((l) => forn.get(l.fornecedor_id));
  return {
    ano, anos,
    totais: { compras: doAno.length, valor_centavos: doAno.reduce((s, c) => s + c.valor_total_centavos, 0), fornecedores: new Set(doAno.flatMap(nomesForn)).size,
      itens: doAno.reduce((s, c) => s + (itens.get(c.id) || []).length, 0) },
    por_mes: [...porMes.values()].concat(semData.quantidade ? [semData] : []),
    por_fornecedor: porValor(porFornecedor, 'valor_centavos'), por_unidade: porValor(porUnidade, 'valor_centavos'), por_natureza: porValor(porNatureza, 'valor_centavos'),
  };
}

// ----------------------------------------------------------------------------------------------------------------- limites das compras por natureza
export function nivelDoLimite(usado, limite, atencao, critico) {
  if (limite === null || limite === undefined) return 'sem_limite';
  if (usado >= limite && usado > 0) return 'estourado';
  const pct = (usado * 100) / limite;
  if (pct >= critico) return 'critico';
  if (pct >= atencao) return 'atencao';
  return 'ok';
}

export function painelLimites(D, ano, unidade = null, parametros = {}) {
  const atencao = parametros.atencao ?? 70;
  const critico = parametros.critico ?? 90;
  const limites = Object.fromEntries(D.limite_legal.filter((l) => l.ano === ano && (l.tipo === 'art75_i' || l.tipo === 'art75_ii')).map((l) => [l.tipo, l.valor_centavos]));
  const conf = new Map(D.conferencia_campo.filter((c) => c.entidade === 'compra_item' && c.campo === 'natureza').map((c) => [c.entidade_id, c.vigente === true]));
  const compras = new Map(D.compra_direta.filter((c) => anoFiscal(c) === ano && (!unidade || c.unidade_gestora === unidade)).map((c) => [c.id, c]));
  const por = new Map(); const sem = { usado_centavos: 0, itens: 0, compras: new Set() }; const noAno = new Set();
  for (const i of D.compra_item) {
    if (!compras.has(i.compra_id)) continue;
    noAno.add(i.compra_id);
    if (i.natureza === null || i.natureza === undefined) { sem.usado_centavos += i.valor_total_centavos; sem.itens += 1; sem.compras.add(i.compra_id); continue; }
    if (!por.has(i.natureza)) por.set(i.natureza, { usado: 0, itens: 0, compras: new Set(), nao_conferidos: 0 });
    const n = por.get(i.natureza);
    n.usado += i.valor_total_centavos; n.itens += 1; n.compras.add(i.compra_id); n.nao_conferidos += conf.get(i.id) ? 0 : 1;
  }
  const naturezas = D.natureza_compra.filter((n) => n.ativo === 1).sort((a, b) => a.ordem - b.ordem).map((n) => {
    const dados = por.get(n.codigo) || { usado: 0, itens: 0, compras: new Set(), nao_conferidos: 0 };
    const limite = limites[n.inciso] ?? null;
    return { codigo: n.codigo, rotulo: n.rotulo, inciso: n.inciso, limite_centavos: limite, usado_centavos: dados.usado, saldo_centavos: limite === null ? null : limite - dados.usado,
      percentual: limite === null ? null : arredondar1((dados.usado * 100) / limite), nivel: nivelDoLimite(dados.usado, limite, atencao, critico), itens: dados.itens,
      compras: dados.compras.size, nao_conferidos: dados.nao_conferidos };
  });
  const anos = new Set([...D.limite_legal.map((l) => l.ano), ...D.compra_direta.map(anoFiscal)]);
  return {
    ano, unidade_gestora: unidade, unidades_gestoras: [...new Set(D.compra_direta.map((c) => c.unidade_gestora).filter((u) => u !== null && u !== undefined))].sort(),
    anos_disponiveis: [...anos].sort((a, b) => b - a), limites: { art75_i: limites.art75_i ?? null, art75_ii: limites.art75_ii ?? null }, limites_cadastrados: Object.keys(limites).length > 0,
    alertas: { atencao_pct: atencao, critico_pct: critico }, naturezas,
    sem_natureza: { usado_centavos: sem.usado_centavos, itens: sem.itens, compras: sem.compras.size },
    totais: { usado_centavos: naturezas.reduce((s, n) => s + n.usado_centavos, 0) + sem.usado_centavos, compras: noAno.size, itens: naturezas.reduce((s, n) => s + n.itens, 0) + sem.itens,
      naturezas_em_atencao: naturezas.filter((n) => n.nivel === 'atencao').length, naturezas_criticas: naturezas.filter((n) => n.nivel === 'critico').length,
      naturezas_estouradas: naturezas.filter((n) => n.nivel === 'estourado').length, itens_a_conferir: naturezas.reduce((s, n) => s + n.nao_conferidos, 0) },
  };
}
