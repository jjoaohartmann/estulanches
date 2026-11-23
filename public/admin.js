'use strict';
// Painel da cantina: pedidos, estoque e reposição.
// A chave fica só na memória da página (não é gravada no navegador).
// Obs.: usamos textContent (e não innerHTML) para evitar XSS.

const reais = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const PROXIMOS = {
  recebido: ['preparando', 'cancelado'],
  preparando: ['pronto', 'cancelado'],
  pronto: ['entregue'],
  entregue: [],
  cancelado: [],
};
const ROTULOS_STATUS = {
  recebido: 'Recebido',
  preparando: 'Em preparo',
  pronto: 'Pronto',
  entregue: 'Entregue',
  cancelado: 'Cancelado',
};
const ROTULOS_ACAO = {
  preparando: 'Iniciar preparo',
  pronto: 'Marcar como pronto',
  entregue: 'Entregar',
  cancelado: 'Cancelar',
};
const ROTULOS_SITUACAO = { ok: 'Normal', baixo: 'Estoque baixo', esgotado: 'Esgotado' };
const ORDEM_SITUACAO = { esgotado: 0, baixo: 1, ok: 2 };
const ROTULOS_MOV = { entrada: 'Entrada', ajuste: 'Ajuste', venda: 'Venda', cancelamento: 'Cancelamento' };

let chave = '';
let temporizador = null;
let seletorPreenchido = false;

function criar(tag, texto, classe) {
  const elemento = document.createElement(tag);
  if (texto !== undefined) elemento.textContent = texto;
  if (classe) elemento.className = classe;
  return elemento;
}

function mensagem(id, texto, erro) {
  const el = document.getElementById(id);
  el.textContent = texto;
  el.className = erro ? 'erro' : 'ok';
}

function linhaVazia(corpo, colunas, texto) {
  const linha = criar('tr');
  const celula = criar('td', texto, 'vazio');
  celula.colSpan = colunas;
  linha.append(celula);
  corpo.replaceChildren(linha);
}

async function api(caminho, opcoes = {}) {
  const resp = await fetch(caminho, {
    ...opcoes,
    headers: { 'Content-Type': 'application/json', 'x-api-key': chave },
  });
  const dados = await resp.json().catch(() => null);
  return { ok: resp.ok, status: resp.status, dados };
}

// ---------------- ABAS ----------------
function mostrarAba(nome) {
  for (const botao of document.querySelectorAll('.abas button')) {
    const ativa = botao.dataset.aba === nome;
    botao.setAttribute('aria-selected', String(ativa));
    document.getElementById(`aba-${botao.dataset.aba}`).hidden = !ativa;
  }
}
for (const botao of document.querySelectorAll('.abas button')) {
  botao.addEventListener('click', () => mostrarAba(botao.dataset.aba));
}

// ---------------- PEDIDOS ----------------
async function carregarPedidos() {
  const { ok, status, dados } = await api('/pedidos');
  if (!ok) {
    clearInterval(temporizador);
    mensagem(
      'aviso',
      status === 401
        ? 'Chave inválida. Confira a ADMIN_API_KEY do arquivo .env.'
        : 'Não foi possível carregar os pedidos.',
      true
    );
    return false;
  }
  mensagem('aviso', 'Conectado. Os dados atualizam a cada 10 segundos.', false);

  const corpo = document.getElementById('pedidos');
  if (dados.length === 0) {
    linhaVazia(corpo, 5, 'Nenhum pedido ainda. Os novos pedidos aparecem aqui.');
    return true;
  }

  corpo.replaceChildren();
  for (const pedido of dados) {
    const linha = criar('tr');

    const celulaStatus = criar('td');
    celulaStatus.append(
      criar('span', ROTULOS_STATUS[pedido.status] || pedido.status, `status status-${pedido.status}`)
    );

    const acoes = criar('td', undefined, 'acoes');
    for (const proximo of PROXIMOS[pedido.status] || []) {
      const botao = criar('button', ROTULOS_ACAO[proximo], proximo === 'cancelado' ? 'perigo' : '');
      botao.type = 'button';
      botao.addEventListener('click', async () => {
        const r = await api(`/pedidos/${pedido.id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: proximo }),
        });
        if (!r.ok) mensagem('aviso', (r.dados && r.dados.erro) || 'Não foi possível atualizar o pedido.', true);
        atualizarTudo(); // cancelar devolve itens ao estoque, então atualiza tudo
      });
      acoes.append(botao);
    }

    linha.append(
      criar('td', `#${pedido.id}`, 'num'),
      criar('td', pedido.cliente),
      criar('td', reais(pedido.total)),
      celulaStatus,
      acoes
    );
    corpo.append(linha);
  }
  return true;
}

// ---------------- ESTOQUE ----------------
function atualizarAlertas(produtos) {
  const visiveis = produtos.filter((p) => p.disponivel);
  const esgotados = visiveis.filter((p) => p.situacaoEstoque === 'esgotado');
  const baixos = visiveis.filter((p) => p.situacaoEstoque === 'baixo');

  const contagem = document.getElementById('contagem-alertas');
  const total = esgotados.length + baixos.length;
  contagem.hidden = total === 0;
  contagem.textContent = total;

  const alerta = document.getElementById('alerta-estoque');
  alerta.hidden = total === 0;
  if (total === 0) return;

  const partes = [];
  if (esgotados.length) {
    partes.push(
      `${esgotados.length} ${esgotados.length === 1 ? 'item esgotado' : 'itens esgotados'} (${esgotados.map((p) => p.nome).join(', ')})`
    );
  }
  if (baixos.length) {
    partes.push(
      `${baixos.length} com estoque baixo (${baixos.map((p) => `${p.nome}: ${p.estoque}`).join(', ')})`
    );
  }
  alerta.textContent = `Atenção: ${partes.join(' e ')}. Faça a reposição.`;
}

function preencherSeletor(produtos) {
  const seletor = document.getElementById('mov-produto');
  const escolhido = seletor.value;
  seletor.replaceChildren();
  const ordenados = [...produtos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  for (const p of ordenados) {
    const opcao = criar('option', `${p.nome} (estoque: ${p.estoque})`);
    opcao.value = p.id;
    seletor.append(opcao);
  }
  if (escolhido) seletor.value = escolhido;
  seletorPreenchido = true;
}

async function carregarEstoque() {
  const { ok, dados } = await api('/produtos/estoque');
  if (!ok) return;

  atualizarAlertas(dados);
  if (!seletorPreenchido) preencherSeletor(dados);

  const corpo = document.getElementById('estoque');
  corpo.replaceChildren();
  // o que precisa de atenção aparece primeiro
  const ordenados = [...dados].sort(
    (a, b) =>
      ORDEM_SITUACAO[a.situacaoEstoque] - ORDEM_SITUACAO[b.situacaoEstoque] ||
      a.nome.localeCompare(b.nome, 'pt-BR')
  );

  for (const p of ordenados) {
    const linha = criar('tr');

    const produto = criar('td');
    produto.append(criar('strong', p.nome), criar('span', ` ${p.categoria}`, 'discreto'));

    const quantidade = criar('td', String(p.estoque), 'num');
    quantidade.append(criar('span', ` mín. ${p.estoqueMinimo}`, 'discreto'));

    const situacao = criar('td');
    situacao.append(
      criar('span', ROTULOS_SITUACAO[p.situacaoEstoque], `status situacao-${p.situacaoEstoque}`)
    );

    const cardapio = criar('td', undefined, 'acoes');
    const botao = criar('button', p.disponivel ? 'Tirar do cardápio' : 'Voltar ao cardápio');
    botao.type = 'button';
    botao.addEventListener('click', async () => {
      const r = await api(`/produtos/${p.id}/disponibilidade`, {
        method: 'PATCH',
        body: JSON.stringify({ disponivel: !p.disponivel }),
      });
      if (!r.ok) mensagem('aviso-estoque', (r.dados && r.dados.erro) || 'Não foi possível atualizar.', true);
      carregarEstoque();
    });
    cardapio.append(botao);
    if (!p.disponivel) cardapio.prepend(criar('span', 'Fora do cardápio ', 'status status-entregue'));

    linha.append(produto, quantidade, situacao, cardapio);
    corpo.append(linha);
  }
}

async function carregarMovimentacoes() {
  const { ok, dados } = await api('/produtos/movimentacoes');
  if (!ok) return;
  const corpo = document.getElementById('movimentacoes');
  if (dados.length === 0) return linhaVazia(corpo, 6, 'Nenhuma movimentação ainda.');

  corpo.replaceChildren();
  for (const m of dados) {
    const quando = new Date(m.criadoEm).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    const tipo = criar('td');
    tipo.append(criar('span', ROTULOS_MOV[m.tipo] || m.tipo, `status mov-${m.tipo}`));

    const linha = criar('tr');
    linha.append(
      criar('td', quando),
      criar('td', m.produto),
      tipo,
      criar('td', m.quantidade > 0 ? `+${m.quantidade}` : String(m.quantidade), 'num'),
      criar('td', String(m.saldoApos)),
      criar('td', m.motivo || '—')
    );
    corpo.append(linha);
  }
  return undefined;
}

// ---------------- FORMULÁRIO DE MOVIMENTAÇÃO ----------------
function ajustarRotulos() {
  const ajuste = document.getElementById('mov-tipo').value === 'ajuste';
  document.getElementById('rotulo-quantidade').textContent = ajuste ? 'Estoque contado (total atual)' : 'Quantidade a repor';
  document.getElementById('rotulo-motivo').textContent = ajuste ? 'Motivo do ajuste (obrigatório)' : 'Motivo (opcional na reposição)';
  document.getElementById('mov-motivo').required = ajuste;
  document.getElementById('mov-quantidade').min = ajuste ? '0' : '1';
}
document.getElementById('mov-tipo').addEventListener('change', ajustarRotulos);

document.getElementById('form-movimentacao').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const id = document.getElementById('mov-produto').value;
  const quantidade = Number(document.getElementById('mov-quantidade').value);
  const corpo = {
    tipo: document.getElementById('mov-tipo').value,
    quantidade,
    motivo: document.getElementById('mov-motivo').value,
  };
  const r = await api(`/produtos/${id}/estoque`, { method: 'POST', body: JSON.stringify(corpo) });
  if (!r.ok) return mensagem('aviso-estoque', (r.dados && r.dados.erro) || 'Não foi possível registrar.', true);

  mensagem('aviso-estoque', `Estoque de ${r.dados.nome} atualizado: ${r.dados.estoque} unidades.`, false);
  document.getElementById('mov-quantidade').value = '';
  document.getElementById('mov-motivo').value = '';
  seletorPreenchido = false; // atualiza os números mostrados no seletor
  return atualizarTudo();
});

// ---------------- ATUALIZAÇÃO GERAL ----------------
async function atualizarTudo() {
  if (!(await carregarPedidos())) return;
  await Promise.all([carregarEstoque(), carregarMovimentacoes()]);
}

document.getElementById('entrar').addEventListener('click', () => {
  chave = document.getElementById('chave').value;
  seletorPreenchido = false;
  clearInterval(temporizador);
  atualizarTudo();
  temporizador = setInterval(atualizarTudo, 10000);
});

ajustarRotulos();
