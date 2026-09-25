# Imagen del bot, independiente de la app del súper.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
# IDLE_AFTER_END: al ganar o quebrar el proceso queda en reposo en vez de salir,
# así Docker no lo reinicia en bucle.
ENV NODE_ENV=production IDLE_AFTER_END=1
CMD ["node", "--no-deprecation", "--import", "tsx", "src/index.ts", "start"]
