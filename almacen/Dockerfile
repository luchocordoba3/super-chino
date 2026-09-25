# Imagen del almacén: la API sirve también la web compilada. Se arma desde la raíz del repo:
#   docker build -f almacen/Dockerfile -t almacen .
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@10.33.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter "./almacen/*..." && pnpm --filter @almacen/web build
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
# Migraciones, datos de demo si SEED_DEMO=true (no duplica) y arranque.
WORKDIR /app/almacen/api
CMD ["sh", "-c", "npx prisma migrate deploy && ( [ \"$SEED_DEMO\" = \"true\" ] && npx tsx prisma/seed.ts || true ) && exec node --import tsx src/index.ts"]
