// Endereco do projeto na nuvem e chave PUBLICA (publishable). Ela e publica por desenho: so abre o que as regras de acesso (RLS) do
// banco permitem a quem esta logado. A chave secreta (de servico) NUNCA entra aqui: fica so no computador servidor (nuvem.json).
export const CONFIG = Object.freeze({
  url: 'https://bzdrumkjyqzhsyjgtkte.supabase.co',
  chavePublica: 'sb_publishable_XeCNQHvleBOu7Q7Bma0JuA_vC-Yqbio',
});
