# EstuLanches 🥪

Sistema de **cardápio, pedidos e estoque da cantina escolar**. O aluno vê o cardápio, monta o pedido e acompanha o status; a cantina usa um painel para avançar os pedidos (recebido → preparando → pronto → entregue) e controlar o estoque.

**Problema que resolve:** filas, pedidos anotados em papel, erros de conta e venda de item que já acabou, na hora do intervalo.

**Video do sistema:** https://drive.google.com/drive/folders/1EYmr819aF15eKa0PdNu8_Y5XRAU879Qr?usp=drive_link

## Tecnologias

| Tecnologia | Para que serve |
|---|---|
| Node.js 22 + Express | API e servidor web |
| PostgreSQL 16 | Banco de dados (pedidos, produtos) |
| Docker + Docker Compose | Empacotar e subir tudo igual em qualquer máquina |
| `node:test` (nativo do Node) | Testes unitários e de integração, sem biblioteca extra |
| helmet + express-rate-limit | Segurança (cabeçalhos HTTP e limite de requisições) |

## Estrutura

```
estulanches/
├── Dockerfile              # receita da imagem da aplicação
├── docker-compose.yml      # sobe app + banco
├── .env.example            # modelo das variáveis secretas
├── db/init.sql             # tabelas + cardápio inicial
├── src/
│   ├── server.js           # liga o servidor, valida configuração, desliga com segurança
│   ├── app.js              # configura Express, segurança, rotas
│   ├── db.js               # conexão com o PostgreSQL (pool)
│   ├── middleware/         # auth.js (chave admin) e erros.js
│   ├── routes/             # produtos.js e pedidos.js
│   └── services/pedidoService.js   # regras de negócio e de estoque (as funções testadas)
├── public/                 # telas: cardápio (index.html) e painel com abas Pedidos/Estoque (admin.html)
├── tests/unit/             # testes unitários
├── tests/integration/      # testes de integração
└── docs/                   # Ficha RDM (PDF) e roteiro do vídeo
```

## Como rodar (produção com Docker)

Pré-requisito: Docker Desktop instalado e aberto.

```bash
# 1) Criar o arquivo de configuração (Windows: copy .env.example .env)
cp .env.example .env
#    -> abra o .env e troque a senha do banco e a chave de admin

# 2) Construir a imagem e subir os serviços
docker compose up -d --build

# 3) Verificar serviços e portas ativas
docker compose ps

# 4) Auditar os logs de inicialização (app e banco)
docker compose logs
```

> **Já tinha subido uma versão anterior?** O banco só cria as tabelas na primeira vez. Como o estoque adicionou colunas e uma tabela nova, rode `docker compose down -v` (apaga os dados de teste) antes do `up`.

Abra **http://localhost:3000** (cardápio) e **http://localhost:3000/admin.html** (painel; use a `ADMIN_API_KEY` do `.env`).

Para parar: `docker compose down` (os dados continuam no volume). Para apagar tudo, inclusive dados: `docker compose down -v`.

## Testes

Com o sistema no ar:

```bash
# Unitários (regras de negócio, sem banco)
docker compose exec app npm test

# Integração (API + PostgreSQL reais, via HTTP)
docker compose exec app npm run test:integration
```

Se tiver Node 20+ instalado na máquina, os unitários também rodam fora do Docker: `npm install` e depois `npm test`.

## Endpoints

| Método | Rota | Acesso | O que faz |
|---|---|---|---|
| GET | `/health` | público | Estado da API e do banco |
| GET | `/produtos` | público | Cardápio com estoque (itens esgotados aparecem como "Esgotado") |
| POST | `/produtos` | **admin** | Cadastra item (com estoque inicial opcional) |
| PATCH | `/produtos/:id/disponibilidade` | **admin** | Tira/coloca o item no cardápio |
| GET | `/produtos/estoque` | **admin** | Posição de estoque de todos os produtos |
| POST | `/produtos/:id/estoque` | **admin** | Reposição (`entrada`) ou ajuste de contagem (`ajuste`, exige motivo) |
| GET | `/produtos/movimentacoes` | **admin** | Histórico das últimas movimentações de estoque |
| POST | `/pedidos` | público | Cria pedido (preço e total no servidor); **recusa com 409 se faltar estoque** |
| GET | `/pedidos/:id` | público | Acompanha o pedido (sem expor o nome do cliente) |
| GET | `/pedidos` | **admin** | Lista pedidos recentes (`?status=`) |
| PATCH | `/pedidos/:id/status` | **admin** | Avança o status (respeita o fluxo); **cancelar devolve os itens ao estoque** |

Rotas **admin** exigem o cabeçalho `x-api-key: <ADMIN_API_KEY>`.

Exemplo:

```bash
curl -X POST http://localhost:3000/pedidos \
  -H "Content-Type: application/json" \
  -d '{"cliente":"Maria","itens":[{"produtoId":1,"quantidade":2}]}'
```

## Controle de estoque

- **Pedido que passa do estoque é recusado inteiro.** Exemplo: pedir 10 coxinhas com 3 em estoque devolve `409` com a mensagem "Coxinha: você pediu 10, mas restam apenas 3". Nada é gravado e o estoque não muda. Se houver vários itens com problema, todos são listados de uma vez.
- **Sem venda dobrada:** a baixa acontece na mesma transação do pedido, com as linhas dos produtos travadas (`SELECT ... FOR UPDATE`). Se 5 clientes disputam as últimas 3 unidades ao mesmo tempo, exatamente 3 compram (há um teste de integração para isso). O banco ainda tem `CHECK (estoque >= 0)` como última barreira.
- **Cancelar devolve ao estoque** automaticamente, uma única vez.
- **Cardápio do aluno:** mostra "Restam N" quando o estoque está baixo, "Esgotado" quando acaba, e o botão `+` para no limite do estoque.
- **Painel da cantina (aba Estoque):** alerta de itens baixos/esgotados (com contador na aba), reposição, ajuste de contagem com motivo obrigatório, botão para tirar item do cardápio e histórico de movimentações (venda, cancelamento, entrada, ajuste).
- **Auditoria:** toda mudança de estoque fica registrada em `movimentacoes_estoque`, com saldo após a movimentação e o número do pedido.

## Segurança

- **Segredos fora do código:** senha do banco e chave admin vêm do `.env` (que está no `.gitignore`).
- **Banco isolado:** o PostgreSQL não publica porta; só a aplicação o acessa pela rede interna do Docker.
- **Container sem privilégios:** a aplicação roda com o usuário `node`, não como root.
- **SQL Injection:** todas as consultas usam parâmetros (`$1`, `$2`).
- **Validação de entrada:** nome, itens, quantidades, preços e ids são validados antes de tocar no banco.
- **Preço e estoque nunca vêm do cliente:** o servidor busca o preço no banco, calcula o total e confere o estoque.
- **XSS:** o front-end usa `textContent` (nunca `innerHTML`) e o `helmet` aplica Content-Security-Policy.
- **Rate limit:** 100 requisições por minuto por IP.
- **Chave admin comparada em tempo constante** (`timingSafeEqual`) e rotas administrativas protegidas.
- **Erros sem vazamento:** o cliente recebe mensagem genérica; os detalhes ficam só no log.
- **Falhar rápido:** o servidor não inicia se faltar variável de ambiente.

## Escalabilidade (visão conceitual: 1 milhão de usuários, 100 mil simultâneos)

A aplicação é **stateless** (não guarda sessão em memória), então pode ser replicada. O caminho:

1. **Várias réplicas da app** atrás de um **balanceador de carga**, com **autoscaling horizontal** (Kubernetes, ECS ou similar). O mesmo Dockerfile gera todas as réplicas.
2. **Cache (Redis)** para o cardápio, que é lido muito mais do que alterado, e **CDN** para HTML/CSS/JS.
3. **Banco de dados:** PostgreSQL gerenciado com **réplicas de leitura**, **pool de conexões** (PgBouncer) e, com o crescimento, **particionamento** da tabela de pedidos (por data ou escola).
4. **Fila de mensagens** (RabbitMQ/SQS) para absorver picos, como o horário do intervalo.
5. **Alta disponibilidade:** múltiplas zonas/regiões do Brasil, com healthchecks e restart automático.
6. **Observabilidade:** métricas, logs centralizados e alertas (Prometheus/Grafana).
7. **Ajustes no código:** mover o rate limit para o Redis (hoje é por instância) e usar logs centralizados.

Estimativa ilustrativa: 100 mil usuários simultâneos, cada um fazendo uma requisição a cada ~10 s, dão cerca de 10 mil requisições/s. Se uma réplica aguentar ~1 mil req/s, bastam algumas dezenas de réplicas com margem de segurança.

## Checklist de entregáveis

- [x] `Dockerfile`
- [x] `docker-compose.yml`
- [x] Testes unitários e de integração
- [ ] Ficha RDM preenchida após a implantação real (`docs/RDM_EstuLanches.pdf`)
- [ ] Vídeo de 2 a 5 minutos (roteiro em `docs/ROTEIRO_VIDEO.md`)
- [ ] Link do repositório nos comentários da atividade
