// Testes UNITÁRIOS: testam as regras de negócio isoladas (sem banco, sem servidor).
// Usam o executor de testes que já vem no Node.js (node:test) => nenhuma biblioteca extra.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  validarCliente,
  validarItens,
  validarProduto,
  calcularTotal,
  statusValido,
  podeMudarStatus,
  idValido,
  consolidarItens,
  classificarEstoque,
  verificarEstoque,
  mensagemEstoque,
  validarMovimentacao,
  calcularSaldo,
} = require('../../src/services/pedidoService');

describe('calcularTotal', () => {
  it('soma preço x quantidade de todas as linhas', () => {
    const total = calcularTotal([
      { preco: 6.5, quantidade: 2 }, // 13,00
      { preco: 5.5, quantidade: 1 }, //  5,50
    ]);
    assert.equal(total, 18.5);
  });

  it('não sofre erro de ponto flutuante (0.1 + 0.2)', () => {
    const total = calcularTotal([
      { preco: 0.1, quantidade: 1 },
      { preco: 0.2, quantidade: 1 },
    ]);
    assert.equal(total, 0.3);
  });

  it('devolve 0 para lista vazia', () => {
    assert.equal(calcularTotal([]), 0);
  });
});

describe('validarCliente', () => {
  it('aceita um nome válido', () => {
    assert.equal(validarCliente('Maria'), null);
  });
  it('rejeita nome vazio, curto, longo ou que não é texto', () => {
    assert.ok(validarCliente(''));
    assert.ok(validarCliente(' A '));
    assert.ok(validarCliente('x'.repeat(81)));
    assert.ok(validarCliente(123));
    assert.ok(validarCliente(undefined));
  });
});

describe('validarItens', () => {
  it('aceita itens válidos', () => {
    assert.equal(validarItens([{ produtoId: 1, quantidade: 2 }]), null);
  });
  it('rejeita lista vazia ou que não é lista', () => {
    assert.ok(validarItens([]));
    assert.ok(validarItens('coxinha'));
    assert.ok(validarItens(undefined));
  });
  it('rejeita quantidade zero, negativa, decimal ou acima do limite', () => {
    assert.ok(validarItens([{ produtoId: 1, quantidade: 0 }]));
    assert.ok(validarItens([{ produtoId: 1, quantidade: -3 }]));
    assert.ok(validarItens([{ produtoId: 1, quantidade: 1.5 }]));
    assert.ok(validarItens([{ produtoId: 1, quantidade: 21 }]));
  });
  it('rejeita produtoId inválido (texto, zero, enorme)', () => {
    assert.ok(validarItens([{ produtoId: '1', quantidade: 1 }]));
    assert.ok(validarItens([{ produtoId: 0, quantidade: 1 }]));
    assert.ok(validarItens([{ produtoId: 99999999999, quantidade: 1 }]));
  });
  it('rejeita pedido com itens demais', () => {
    const muitos = Array.from({ length: 21 }, () => ({ produtoId: 1, quantidade: 1 }));
    assert.ok(validarItens(muitos));
  });
});

describe('validarProduto', () => {
  it('aceita um produto válido', () => {
    assert.equal(validarProduto({ nome: 'Pastel', preco: 7.5, categoria: 'Salgados' }), null);
  });
  it('rejeita preço inválido', () => {
    assert.ok(validarProduto({ nome: 'Pastel', preco: 0, categoria: 'Salgados' }));
    assert.ok(validarProduto({ nome: 'Pastel', preco: -1, categoria: 'Salgados' }));
    assert.ok(validarProduto({ nome: 'Pastel', preco: '7', categoria: 'Salgados' }));
    assert.ok(validarProduto({ nome: 'Pastel', preco: 7.555, categoria: 'Salgados' }));
  });
  it('rejeita corpo vazio', () => {
    assert.ok(validarProduto(undefined));
    assert.ok(validarProduto({}));
  });
});

describe('status do pedido', () => {
  it('reconhece apenas status existentes', () => {
    assert.equal(statusValido('pronto'), true);
    assert.equal(statusValido('voando'), false);
  });
  it('permite o fluxo normal: recebido -> preparando -> pronto -> entregue', () => {
    assert.equal(podeMudarStatus('recebido', 'preparando'), true);
    assert.equal(podeMudarStatus('preparando', 'pronto'), true);
    assert.equal(podeMudarStatus('pronto', 'entregue'), true);
  });
  it('bloqueia pular etapas ou mexer em pedido finalizado', () => {
    assert.equal(podeMudarStatus('recebido', 'entregue'), false);
    assert.equal(podeMudarStatus('entregue', 'preparando'), false);
    assert.equal(podeMudarStatus('cancelado', 'recebido'), false);
  });
});

describe('idValido', () => {
  it('converte ids corretos', () => {
    assert.equal(idValido('15'), 15);
  });
  it('rejeita ids perigosos ou inválidos', () => {
    assert.equal(idValido('abc'), null);
    assert.equal(idValido('1; DROP TABLE pedidos'), null);
    assert.equal(idValido('-5'), null);
    assert.equal(idValido('0'), null);
    assert.equal(idValido('99999999999'), null);
  });
});

// ---------------- ESTOQUE ----------------

describe('classificarEstoque', () => {
  it('esgotado quando chega a zero', () => {
    assert.equal(classificarEstoque(0, 5), 'esgotado');
  });
  it('baixo quando está no mínimo ou abaixo dele', () => {
    assert.equal(classificarEstoque(5, 5), 'baixo');
    assert.equal(classificarEstoque(1, 5), 'baixo');
  });
  it('ok quando está acima do mínimo', () => {
    assert.equal(classificarEstoque(6, 5), 'ok');
  });
});

describe('consolidarItens e limite por produto', () => {
  it('junta linhas repetidas do mesmo produto e ordena por id', () => {
    const r = consolidarItens([
      { produtoId: 3, quantidade: 1 },
      { produtoId: 1, quantidade: 2 },
      { produtoId: 3, quantidade: 4 },
    ]);
    assert.deepEqual(r, [
      { produtoId: 1, quantidade: 2 },
      { produtoId: 3, quantidade: 5 },
    ]);
  });
  it('rejeita quando a soma do mesmo produto passa de 20 unidades', () => {
    const erro = validarItens([
      { produtoId: 1, quantidade: 15 },
      { produtoId: 1, quantidade: 10 },
    ]);
    assert.ok(erro);
  });
});

describe('verificarEstoque (pedir 10 coxinhas com 3 em estoque)', () => {
  const produtos = new Map([
    [1, { id: 1, nome: 'Coxinha', disponivel: true, estoque: 3 }],
    [2, { id: 2, nome: 'Suco natural', disponivel: true, estoque: 0 }],
    [3, { id: 3, nome: 'Bolo', disponivel: false, estoque: 9 }],
    [4, { id: 4, nome: 'Água', disponivel: true, estoque: 50 }],
  ]);

  it('aceita quando há estoque suficiente (inclusive pedir exatamente o que resta)', () => {
    assert.deepEqual(verificarEstoque([{ produtoId: 1, quantidade: 3 }, { produtoId: 4, quantidade: 2 }], produtos), []);
  });
  it('recusa quando o pedido passa do estoque e informa quantas restam', () => {
    const problemas = verificarEstoque([{ produtoId: 1, quantidade: 10 }], produtos);
    assert.equal(problemas.length, 1);
    assert.equal(problemas[0].motivo, 'insuficiente');
    assert.equal(problemas[0].restam, 3);
    assert.equal(mensagemEstoque(problemas), 'Coxinha: você pediu 10, mas restam apenas 3');
  });
  it('recusa produto esgotado, fora do cardápio ou inexistente', () => {
    const problemas = verificarEstoque(
      [{ produtoId: 2, quantidade: 1 }, { produtoId: 3, quantidade: 1 }, { produtoId: 99, quantidade: 1 }],
      produtos
    );
    assert.deepEqual(problemas.map((p) => p.motivo), ['esgotado', 'indisponivel', 'inexistente']);
  });
  it('lista todos os problemas de uma vez', () => {
    const problemas = verificarEstoque([{ produtoId: 1, quantidade: 10 }, { produtoId: 2, quantidade: 1 }], produtos);
    assert.equal(mensagemEstoque(problemas), 'Coxinha: você pediu 10, mas restam apenas 3; Suco natural está esgotado');
  });
});

describe('movimentação de estoque', () => {
  it('aceita reposição válida', () => {
    assert.equal(validarMovimentacao({ tipo: 'entrada', quantidade: 20 }), null);
  });
  it('rejeita reposição zero, negativa ou decimal', () => {
    assert.ok(validarMovimentacao({ tipo: 'entrada', quantidade: 0 }));
    assert.ok(validarMovimentacao({ tipo: 'entrada', quantidade: -5 }));
    assert.ok(validarMovimentacao({ tipo: 'entrada', quantidade: 2.5 }));
  });
  it('ajuste exige motivo e aceita contagem zero', () => {
    assert.ok(validarMovimentacao({ tipo: 'ajuste', quantidade: 4 }));
    assert.equal(validarMovimentacao({ tipo: 'ajuste', quantidade: 0, motivo: 'Perda por validade' }), null);
  });
  it('rejeita tipo desconhecido e corpo vazio', () => {
    assert.ok(validarMovimentacao({ tipo: 'roubo', quantidade: 1 }));
    assert.ok(validarMovimentacao(undefined));
  });
  it('calcula o saldo: entrada soma, ajuste define o valor exato', () => {
    assert.equal(calcularSaldo('entrada', 3, 20), 23);
    assert.equal(calcularSaldo('ajuste', 3, 12), 12);
  });
});
