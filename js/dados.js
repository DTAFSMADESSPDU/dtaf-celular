// Calculos e formatos do aplicativo do celular. Funcoes puras (sem rede, sem tela, sem relogio escondido).
// Reproduzem app/vigencia.py, o saldo do TAC (app/tac.py) e o saldo do fundo (app/fundos.py). O arquivo testes/vetores.json,
// gerado pelo Python, prova a equivalencia (testes.html). Nada e presumido: sem data, a vigencia fica "a definir".

export const DEGRAUS_PADRAO = [180, 120, 90, 60, 30];
const AFETAM_PRAZO = new Set(['aditivo_prazo', 'aditivo_prazo_valor']);

const dois = (n) => String(n).padStart(2, '0');

function partes(iso) {
  const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return { a, m, d };
}

/** Mesmo dia do mes (art. 132, par. 3, do Codigo Civil); se nao existir, o ultimo dia do mes. */
export function somarMeses(iso, meses) {
  const { a, m, d } = partes(iso);
  const total = a * 12 + (m - 1) + meses;
  const ano = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${String(ano).padStart(4, '0')}-${dois(mes)}-${dois(Math.min(d, ultimo))}`;
}

/** Dias entre duas datas ISO (b - a). */
export function diasEntre(a, b) {
  const x = partes(a);
  const y = partes(b);
  return Math.round((Date.UTC(y.a, y.m - 1, y.d) - Date.UTC(x.a, x.m - 1, x.d)) / 86400000);
}

function ordenados(movimentos) {
  const chave = (m) => [m.data_assinatura || m.data_assinatura_fecho || '9999-12-31', m.ordem || 0, m.id];
  return [...movimentos].sort((p, q) => {
    const a = chave(p);
    const b = chave(q);
    if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
    if (a[1] !== b[1]) return a[1] - b[1];
    return a[2] - b[2];
  });
}

export function calcularVigencia(contrato, movimentos) {
  const inicio = contrato.vigencia_inicio || null;
  let fim = null;
  let origem = 'a_definir';
  if (contrato.vigencia_fim_informada) {
    fim = contrato.vigencia_fim_informada;
    origem = 'informada';
  } else if (inicio && contrato.prazo_meses) {
    fim = somarMeses(inicio, contrato.prazo_meses);
    origem = 'calculada';
  }
  for (const m of ordenados(movimentos)) {
    if (m.nova_vigencia_fim) {
      fim = m.nova_vigencia_fim;
      origem = `aditivo ${m.ordem === null || m.ordem === undefined ? 'None' : m.ordem}`; // "None" como no Python (a ordem real nunca e vazia)
    } else if (AFETAM_PRAZO.has(m.tipo) && m.prazo_meses && fim) {
      fim = somarMeses(fim, m.prazo_meses);
      origem = 'calculada';
    }
  }
  return { inicio, fim, origem: fim ? origem : 'a_definir' };
}

export function alerta(fim, hoje, degraus = DEGRAUS_PADRAO) {
  if (!fim) return { situacao: 'a_definir', dias: null, degrau: null };
  const dias = diasEntre(hoje, fim);
  if (dias < 0) return { situacao: 'vencido', dias, degrau: null };
  const degrau = [...degraus].sort((x, y) => x - y).find((g) => dias <= g);
  return degrau === undefined ? { situacao: 'vigente', dias, degrau: null } : { situacao: 'a_vencer', dias, degrau };
}

export function valorAtual(contrato, movimentos) {
  let atual = contrato.valor_inicial_centavos;
  if (atual === null || atual === undefined) return null;
  for (const m of ordenados(movimentos)) {
    if (m.novo_valor_global_centavos !== null && m.novo_valor_global_centavos !== undefined) atual = m.novo_valor_global_centavos;
    else if (m.valor_variacao_centavos) atual += m.valor_variacao_centavos;
  }
  return atual;
}

/** TAC: pago = soma dos pagamentos; saldo = valor - pago; quitado = valor > 0 e pago >= valor. */
export function saldoTac(tac, pagamentos) {
  const pago = pagamentos.reduce((s, p) => s + p.valor_centavos, 0);
  return { pago, saldo: tac.valor_centavos - pago, quitado: tac.valor_centavos > 0 && pago >= tac.valor_centavos };
}

/** Fundo: saldo inicial + entradas e resgates - saidas e aplicacoes. */
export function saldoConta(conta, lancamentos) {
  return lancamentos.reduce((s, l) => s + (l.tipo === 'entrada' || l.tipo === 'resgate' ? l.valor_centavos : -l.valor_centavos), conta.saldo_inicial_centavos);
}

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const reais = (centavos) => (centavos === null || centavos === undefined ? '' : moeda.format(centavos / 100));

/** R$ compacto para rotulos de grafico: 1,2 mi, 345 mil, 9,6 mil. */
export function reaisCompacto(centavos) {
  const v = centavos / 100;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

export function dataBR(iso) {
  if (!iso) return '';
  const { a, m, d } = partes(iso);
  return `${dois(d)}/${dois(m)}/${a}`;
}

/** Data e hora local de um instante ISO (UTC), para "espelho de ...". */
export function instanteBR(iso) {
  if (!iso) return '';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return String(iso);
  return `${dois(t.getDate())}/${dois(t.getMonth() + 1)}/${t.getFullYear()} ${dois(t.getHours())}:${dois(t.getMinutes())}`;
}

export function hojeISO(agora = new Date()) {
  return `${agora.getFullYear()}-${dois(agora.getMonth() + 1)}-${dois(agora.getDate())}`;
}

/** Texto sem acento e em minusculas, para busca. */
export const normalizar = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Regra da senha da nuvem (a mesma do DTAF): 12 caracteres ou mais, com minusculas, maiusculas e digitos. Devolve '' quando esta boa. */
export function problemaDeSenha(nova) {
  if (nova.length < 12) return 'A senha precisa ter 12 caracteres ou mais.';
  if (!/[a-z]/.test(nova) || !/[A-Z]/.test(nova) || !/[0-9]/.test(nova)) return 'A senha precisa ter letras maiúsculas, minúsculas e números.';
  return '';
}

export function horasDesde(iso, agora = new Date()) {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? null : (agora.getTime() - t.getTime()) / 3600000;
}
