# Imagen del bot, independiente de la app del súper.
FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml ./
COPY memebot ./memebot
RUN pip install --no-cache-dir .
# IDLE_AFTER_END: al ganar o quebrar, el proceso queda en reposo en vez de salir,
# así Docker no lo reinicia en bucle.
ENV PYTHONUNBUFFERED=1 IDLE_AFTER_END=1
CMD ["python", "-m", "memebot", "start"]
