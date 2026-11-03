# 画面（React）をビルドし、API（FastAPI）と同じコンテナから配信する
FROM node:22-slim AS web
WORKDIR /src
COPY fixtures ./fixtures
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci
COPY web ./web
RUN cd web && npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY api/pyproject.toml ./api/
COPY api/app ./api/app
RUN pip install ./api
COPY fixtures ./fixtures
COPY --from=web /src/web/dist ./static

ENV STATIC_DIR=/app/static FIXTURE_PATH=/app/fixtures/demo.json PORT=8080
RUN useradd --create-home --uid 10001 app
USER app
WORKDIR /app/api
EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn app.main:create_app --factory --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
