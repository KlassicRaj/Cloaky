FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=3000 \
    COOKIE_SECURE=true

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force

COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node knexfile.js ./

USER node

EXPOSE 3000

CMD ["node", "src/server.js"]
