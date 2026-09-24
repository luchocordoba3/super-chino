# Imagen única: la API sirve también la web compilada.
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @super-chino/web build
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["sh", "-c", "pnpm --filter @super-chino/api db:deploy && pnpm --filter @super-chino/api start"]
