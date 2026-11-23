# ---------- Imagem da aplicação EstuLanches ----------

# 1) Imagem base: Node.js 22 na versão "alpine" (pequena = mais rápida e com menos falhas de segurança)
FROM node:22-alpine

# 2) Modo produção: o Node e as bibliotecas ficam mais rápidos e não mostram detalhes de erro
ENV NODE_ENV=production

# 3) Pasta de trabalho dentro do container
WORKDIR /app

# 4) Copia SÓ o package.json primeiro e instala as dependências.
#    Assim o Docker guarda essa etapa em cache e não reinstala tudo a cada mudança no código.
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# 5) Copia o restante do código (o .dockerignore evita copiar lixo e segredos)
COPY . .

# 6) Segurança: roda como usuário "node" (sem poderes de administrador) e não como root
USER node

# 7) Porta em que a aplicação escuta
EXPOSE 3000

# 8) Healthcheck: a cada 30s o Docker pergunta "você está bem?" para o endpoint /health
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# 9) Comando que inicia o sistema
CMD ["node", "src/server.js"]
