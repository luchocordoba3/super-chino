# Imagen única: la API sirve también la web compilada.
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@10.33.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @super-chino/web build
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
# Migraciones, datos de demo si SEED_DEMO=true (no duplica) y arranque sin procesos intermedios (512 MB en el plan gratis).
WORKDIR /app/apps/api
CMD ["sh", "-c", "npx prisma migrate deploy && ( [ \"$SEED_DEMO\" = \"true\" ] && npx tsx prisma/seed.ts || true ) && exec node --import tsx src/index.ts"]
