FROM node:22-bookworm-slim AS frontend
WORKDIR /app/frontend/adal-ai/frontend
COPY frontend/adal-ai/frontend/package*.json ./
RUN npm ci
COPY frontend/adal-ai/frontend/ ./
COPY backend/app/static /app/backend/app/static
RUN npm run build

FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app/backend
COPY backend/requirements.lock backend/pyproject.toml ./
RUN pip install -r requirements.lock
COPY backend/app ./app
RUN pip install --no-deps .
COPY --from=frontend /app/frontend/adal-ai/frontend/dist /app/frontend/adal-ai/frontend/dist
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*' --no-access-log"]
