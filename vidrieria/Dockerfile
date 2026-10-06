# Imagen única: la API sirve también la web compilada.
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@10.33.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @vidrieria/web build
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
# Schema propio, migraciones, demo si SEED_DEMO=true y arranque (ver apps/api/scripts/start.ts).
WORKDIR /app/apps/api
CMD ["node", "--import", "tsx", "scripts/start.ts"]
