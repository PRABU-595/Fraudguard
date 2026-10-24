# syntax=docker/dockerfile:1
FROM python:3.12-slim AS base

# Prevent Python from writing .pyc and enable unbuffered logging
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8081 \
    STORAGE_BACKEND=dynamodb \
    ENABLE_DEMO_SIMULATOR=false

WORKDIR /app

# Install security updates and curl for healthchecks
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Create non-root application user for least-privilege security
RUN useradd -m -u 10001 -s /bin/bash appuser

# Copy application code, static assets, schemas, and default data
COPY src/ /app/src/
COPY static/ /app/static/
COPY schema/ /app/schema/
COPY data/ /app/data/

# Ensure directory permissions for appuser
RUN mkdir -p /app/data /app/logs && \
    chown -R appuser:appuser /app

USER appuser

EXPOSE 8081

# Container healthcheck targeting the console health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8081/api/health || exit 1

ENTRYPOINT ["python", "-u", "src/stream_monitor.py"]
