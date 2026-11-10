# Single container: API + WebSocket rooms + built client. Used by Hugging Face Spaces (Docker SDK).
# glibc base (bookworm), because the lockfile pins the linux-x64-gnu builds of rolldown, tailwind, esbuild, lightningcss, tsc.
FROM node:22-bookworm-slim

# Spaces run the container as uid 1000; the official image's `node` user is uid 1000.
WORKDIR /app
RUN chown node:node /app
USER node

# Install dependencies first so code-only changes reuse this layer.
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node shared/package.json shared/
COPY --chown=node:node server/package.json server/
COPY --chown=node:node client/package.json client/
RUN npm ci --include=dev --no-audit --no-fund

COPY --chown=node:node . .
RUN npm run build

# Spaces route traffic to app_port (7860, see README front matter). Secrets come from Space settings as env vars.
ENV NODE_ENV=production PORT=7860
EXPOSE 7860
CMD ["npm", "start"]
