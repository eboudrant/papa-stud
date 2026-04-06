FROM python:3.14-slim

RUN groupadd -r papastud && useradd -r -g papastud -d /app papastud

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server/ server/
COPY static/ static/
COPY server.py .

RUN mkdir -p data && chown -R papastud:papastud /app

ENV PYTHONUNBUFFERED=1

USER papastud

EXPOSE 8770

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8770/api/health')" || exit 1

CMD ["python3", "server.py"]
