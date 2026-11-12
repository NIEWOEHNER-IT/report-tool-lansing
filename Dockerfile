# Bautagesbericht LANSING: ein Container mit API, Formular, Admin-Bereich, SQLite und Berichtsdateien.
# Build-Kontext: Projektwurzel. Laufzeitvariablen siehe .env.example und deploy/web02/stack.yml.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY scripts ./scripts
COPY shared ./shared
COPY bridge ./bridge
COPY server ./server
COPY frontend ./frontend
RUN node scripts/build.mjs --frontend --server

FROM node:22-alpine AS runtime-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    STATIC_DIR=/app/frontend
WORKDIR /app
# Einzige npm-Laufzeitabhängigkeit: nodemailer (E-Mail-Kopie). Sonst Node-Bordmittel (node:sqlite, node:http).
COPY --from=runtime-deps /app/node_modules ./node_modules
COPY package.json ./
COPY --from=build /app/dist/frontend ./frontend
COPY --from=build /app/dist/server ./server
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
