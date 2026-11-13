// Conversa com a nuvem: entrar, renovar a sessao, sair e LER tabelas do espelho. Nao existe nenhuma chamada de escrita de dados:
// as unicas requisicoes POST sao as do login (/auth/v1). O celular so visualiza (D53).
import { CONFIG } from './config.js';

const CHAVE_SESSAO = 'dtaf.sessao';
const FOLGA = 60; // segundos antes de vencer em que a sessao ja e renovada
const POR_PAGINA = 1000;

export class ErroNuvem extends Error {
  constructor(tipo) {
    super(tipo);
    this.tipo = tipo; // credenciais | sessao | rede | servidor
  }
}

let sessao = null;

function guardar(nova) {
  sessao = nova;
  try {
    if (nova) localStorage.setItem(CHAVE_SESSAO, JSON.stringify(nova));
    else localStorage.removeItem(CHAVE_SESSAO);
  } catch (e) {
    // armazenamento bloqueado: a sessao vale so enquanto a pagina estiver aberta
  }
}

export function carregarSessao() {
  try {
    const texto = localStorage.getItem(CHAVE_SESSAO);
    sessao = texto ? JSON.parse(texto) : null;
  } catch (e) {
    sessao = null;
  }
  return sessao !== null && typeof sessao.refresh_token === 'string';
}

async function chamar(caminho, { metodo = 'GET', corpo, token } = {}) {
  const cabecalhos = { apikey: CONFIG.chavePublica, Accept: 'application/json' };
  if (token) cabecalhos.Authorization = `Bearer ${token}`;
  if (corpo !== undefined) cabecalhos['Content-Type'] = 'application/json';
  let resposta;
  try {
    resposta = await fetch(CONFIG.url + caminho, { method: metodo, headers: cabecalhos, body: corpo === undefined ? undefined : JSON.stringify(corpo), cache: 'no-store', referrerPolicy: 'no-referrer' });
  } catch (e) {
    throw new ErroNuvem('rede');
  }
  return resposta;
}

function daResposta(json) {
  return { access_token: json.access_token, refresh_token: json.refresh_token, expira_em: Math.floor(Date.now() / 1000) + (json.expires_in || 3600), email: json.user && json.user.email };
}

export async function entrar(email, senha) {
  const r = await chamar('/auth/v1/token?grant_type=password', { metodo: 'POST', corpo: { email, password: senha } });
  if (r.status === 400 || r.status === 401 || r.status === 422) throw new ErroNuvem('credenciais');
  if (!r.ok) throw new ErroNuvem('servidor');
  guardar(daResposta(await r.json()));
}

async function renovar() {
  if (!sessao) throw new ErroNuvem('sessao');
  const r = await chamar('/auth/v1/token?grant_type=refresh_token', { metodo: 'POST', corpo: { refresh_token: sessao.refresh_token } });
  if (r.status === 400 || r.status === 401) {
    guardar(null);
    throw new ErroNuvem('sessao');
  }
  if (!r.ok) throw new ErroNuvem('servidor');
  guardar(daResposta(await r.json()));
}

async function token() {
  if (!sessao) throw new ErroNuvem('sessao');
  if (Math.floor(Date.now() / 1000) >= sessao.expira_em - FOLGA) await renovar();
  return sessao.access_token;
}

export async function sair() {
  const atual = sessao && sessao.access_token;
  guardar(null);
  if (atual) {
    try {
      await chamar('/auth/v1/logout?scope=local', { metodo: 'POST', token: atual });
    } catch (e) {
      // sem rede: a sessao local ja foi apagada
    }
  }
}

/** Le a tabela inteira (de mil em mil linhas). Devolve [] quando as regras de acesso nao liberam nada. */
export async function lerTabela(nome, ordem) {
  const linhas = [];
  for (let inicio = 0; ; inicio += POR_PAGINA) {
    let r = await chamar(`/rest/v1/${nome}?select=*&limit=${POR_PAGINA}&offset=${inicio}${ordem ? `&order=${ordem}` : ''}`, { token: await token() });
    if (r.status === 401) {
      await renovar();
      r = await chamar(`/rest/v1/${nome}?select=*&limit=${POR_PAGINA}&offset=${inicio}${ordem ? `&order=${ordem}` : ''}`, { token: await token() });
    }
    if (r.status === 401 || r.status === 403) throw new ErroNuvem('sessao');
    if (!r.ok) throw new ErroNuvem('servidor');
    const pagina = await r.json();
    linhas.push(...pagina);
    if (pagina.length < POR_PAGINA) return linhas;
  }
}
