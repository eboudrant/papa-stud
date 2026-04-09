FROM node:24-slim

RUN groupadd -r papastud && useradd -r -g papastud -d /app papastud

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src/ src/
COPY static/ static/

RUN mkdir -p data && chown -R papastud:papastud /app

USER papastud

EXPOSE 8770

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8770/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "src/server.js"]
