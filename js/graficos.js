// Graficos do aplicativo do celular, em SVG e elementos, sem biblioteca e sem texto virando HTML. Cada fatia, barra ou coluna e um botao
// (teclado e toque) que devolve o item clicado, para a tela filtrar a lista. Cores: variaveis --c0 a --c7 do CSS (conferidas nos dois temas).
const NS = 'http://www.w3.org/2000/svg';

export function svg(tag, atributos = {}, ...filhos) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(atributos)) if (v !== null && v !== undefined) e.setAttribute(k, String(v));
  for (const f of filhos.flat(Infinity)) if (f) e.append(f);
  return e;
}

function html(tag, classe, ...filhos) {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  for (const f of filhos.flat()) if (f !== null && f !== undefined && f !== false) e.append(f);
  return e;
}

export const pct = (n) => (n === null || n === undefined ? '—' : `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);

/** Os N maiores e um item "Outros" com o resto (junta os ids de cada grupo). */
export function principaisEOutros(grupos, n, campoValor, campoIds, rotuloOutros = 'Outros') {
  if (grupos.length <= n) return grupos;
  const resto = grupos.slice(n);
  return [...grupos.slice(0, n), { chave: '__outros', rotulo: rotuloOutros, quantidade: resto.reduce((s, g) => s + g.quantidade, 0),
    [campoValor]: resto.reduce((s, g) => s + g[campoValor], 0), [campoIds]: resto.flatMap((g) => g[campoIds]) }];
}

function ponto(cx, cy, r, graus) {
  const a = ((graus - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

/** Rosca com legenda. entradas: [{chave, rotulo, valor, ...}]. No centro: o total, ou o item sob o dedo/mouse/foco. */
export function rosca(entradas, { formato, aoClicar = null, rotuloTotal = 'Total', descricao = 'Gráfico de rosca' } = {}) {
  const itens = entradas.filter((e) => e.valor > 0);
  const total = itens.reduce((s, e) => s + e.valor, 0);
  const centroNome = html('div', 'rosca-nome', rotuloTotal);
  const centroValor = html('div', 'rosca-valor', formato(total));
  const mostrar = (e) => { centroNome.textContent = e ? e.rotulo : rotuloTotal; centroValor.textContent = e ? `${formato(e.valor)} · ${pct((e.valor * 100) / total)}` : formato(total); };
  const arcos = []; const linhas = [];
  let angulo = 0;
  itens.forEach((e, i) => {
    const fatia = (e.valor / total) * 360;
    const fim = angulo + (fatia >= 359.99 ? 359.99 : fatia);
    const [x1, y1] = ponto(60, 60, 44, angulo); const [x2, y2] = ponto(60, 60, 44, fim);
    const arco = svg('path', { d: `M ${x1.toFixed(2)} ${y1.toFixed(2)} A 44 44 0 ${fim - angulo > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`, class: `fatia c${i % 8}`, fill: 'none', 'stroke-width': 20,
      role: 'button', tabindex: 0, 'aria-label': `${e.rotulo}: ${formato(e.valor)}` });
    const ligar = (alvo) => { alvo.addEventListener('mouseenter', () => mostrar(e)); alvo.addEventListener('mouseleave', () => mostrar(null)); alvo.addEventListener('focus', () => mostrar(e)); alvo.addEventListener('blur', () => mostrar(null));
      alvo.addEventListener('click', () => { mostrar(e); if (aoClicar) aoClicar(e); }); alvo.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); mostrar(e); if (aoClicar) aoClicar(e); } }); };
    ligar(arco); arcos.push(arco);
    const linha = html('button', 'legenda-item', html('span', `chave c${i % 8}`), html('span', 'legenda-nome', e.rotulo), html('span', 'legenda-valor', `${formato(e.valor)} · ${pct((e.valor * 100) / total)}`));
    linha.type = 'button'; ligar(linha); linhas.push(linha);
    angulo = fim;
  });
  if (!itens.length) return html('p', 'vazio', 'Sem dados.');
  return html('div', 'rosca', html('div', 'rosca-figura', svg('svg', { viewBox: '0 0 120 120', role: 'group', 'aria-label': descricao, class: 'rosca-svg' }, arcos), html('div', 'rosca-centro', centroNome, centroValor)),
    html('div', 'legenda', linhas));
}

/** Barras horizontais: [{rotulo, valor, ...}] ja ordenadas. */
export function barras(linhas, { formato, aoClicar = null, campo = 'valor' } = {}) {
  const max = Math.max(1, ...linhas.map((l) => l[campo]));
  const corpo = linhas.map((l) => {
    const barra = html('span', 'barra');
    barra.style.width = `${Math.max(2, (l[campo] / max) * 100)}%`;
    const b = html('button', 'barra-linha', html('span', 'barra-nome', l.rotulo), html('span', 'barra-valor', formato(l[campo])), html('span', 'barra-trilho', barra));
    b.type = 'button';
    if (aoClicar) b.addEventListener('click', () => aoClicar(l)); else b.disabled = true;
    return b;
  });
  return linhas.length ? html('div', 'barras', corpo) : html('p', 'vazio', 'Sem dados.');
}

/** Colunas (linha do tempo): [{rotulo, valor, ...}], com rolagem lateral quando e comprido. */
export function colunas(serie, { formato, aoClicar = null, campo = 'valor', descricao = 'Gráfico de colunas' } = {}) {
  const max = Math.max(1, ...serie.map((s) => s[campo]));
  const largura = 40; const altura = 120; const topo = 14; const base = 26;
  const barrasSvg = serie.map((s, i) => {
    const h = s[campo] > 0 ? Math.max(3, (s[campo] / max) * altura) : 0;
    const x = i * largura + 6;
    const r = svg('rect', { x, y: topo + altura - h, width: largura - 12, height: h, class: 'coluna c0', rx: 3, role: 'button', tabindex: 0, 'aria-label': `${s.rotulo}: ${formato(s[campo])}` });
    const acionar = () => { if (aoClicar && s[campo] > 0) aoClicar(s); };
    r.addEventListener('click', acionar); r.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); acionar(); } });
    const valor = s[campo] > 0 ? svg('text', { x: x + (largura - 12) / 2, y: topo + altura - h - 3, class: 'coluna-valor', 'text-anchor': 'middle' }) : null;
    if (valor) valor.textContent = formato(s[campo]);
    const nome = svg('text', { x: x + (largura - 12) / 2, y: topo + altura + 15, class: 'coluna-nome', 'text-anchor': 'middle' });
    const curto = s.rotulo.replace(/\/20(\d\d)$/, '/$1'); // dez/2026 vira dez/26
    nome.textContent = curto.length > 7 ? curto.slice(0, 7) : curto;
    return [r, valor, nome];
  });
  const figura = svg('svg', { viewBox: `0 0 ${serie.length * largura} ${topo + altura + base}`, width: serie.length * largura, height: topo + altura + base, role: 'group', 'aria-label': descricao, class: 'colunas-svg' }, barrasSvg);
  return serie.length ? html('div', 'colunas', figura) : html('p', 'vazio', 'Sem dados.');
}

/** Medidor de uso do limite: percentual (0 a 100+) e nivel (ok, atencao, critico, estourado, sem_limite). */
export function medidor(percentual, nivel) {
  const preenchido = html('span', `medidor-cheio nivel-${nivel}`);
  preenchido.style.width = `${Math.min(100, Math.max(0, percentual || 0))}%`;
  return html('span', 'medidor', preenchido);
}

export function kpi(rotulo, valor, apoio, aoClicar = null) {
  const e = html(aoClicar ? 'button' : 'div', 'kpi', html('span', 'kpi-nome', rotulo), html('span', 'kpi-valor', valor), apoio ? html('span', 'kpi-apoio', apoio) : null);
  if (aoClicar) { e.type = 'button'; e.addEventListener('click', aoClicar); }
  return e;
}
