const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { query } = require('./db');
const { version } = require('../package.json');
const produtosRoutes = require('./routes/produtos');
const pedidosRoutes = require('./routes/pedidos');
const { rotaNaoEncontrada, tratarErros, asyncHandler } = require('./middleware/erros');

const app = express();

// Segurança: cabeçalhos HTTP protetores (CSP, X-Content-Type-Options, etc.)
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: { 'upgrade-insecure-requests': null }, // o projeto roda em http://localhost
    },
  })
);

// Lê JSON do corpo da requisição, com limite de tamanho (evita corpos gigantes)
app.use(express.json({ limit: '10kb' }));

// Log de cada requisição em formato JSON (facilita auditar com "docker compose logs")
app.use((req, res, next) => {
  if (req.path === '/health') return next(); // não poluir o log com o healthcheck
  const inicio = Date.now();
  res.on('finish', () => {
    console.log(
      JSON.stringify({
        hora: new Date().toISOString(),
        metodo: req.method,
        rota: req.originalUrl,
        status: res.statusCode,
        ms: Date.now() - inicio,
      })
    );
  });
  return next();
});

// Front-end (páginas HTML/CSS/JS da pasta public)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Healthcheck: usado pelo Docker e para monitoramento. Testa também o banco.
app.get(
  '/health',
  asyncHandler(async (req, res) => {
    try {
      await query('SELECT 1');
      res.json({ status: 'ok', banco: 'ok', versao: version });
    } catch (err) {
      res.status(503).json({ status: 'erro', banco: 'indisponivel', versao: version });
    }
  })
);

// Limite de requisições por IP (proteção contra abuso / força bruta)
const limitador = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.RATE_LIMIT) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas requisições. Tente novamente em instantes.' },
});

app.use(['/produtos', '/pedidos'], limitador);
app.use('/produtos', produtosRoutes);
app.use('/pedidos', pedidosRoutes);

app.use(rotaNaoEncontrada);
app.use(tratarErros);

module.exports = app;
