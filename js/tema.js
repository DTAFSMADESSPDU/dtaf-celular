// Aplica o tema escolhido (claro ou escuro) antes de a tela aparecer, para nao piscar. Sem escolha, vale o do aparelho.
try {
  const escolhido = localStorage.getItem('dtaf.tema');
  if (escolhido === 'claro' || escolhido === 'escuro') document.documentElement.dataset.tema = escolhido;
} catch (e) {
  // sem armazenamento: segue o tema do aparelho
}
