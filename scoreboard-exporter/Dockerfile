# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS deps
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

# Dev stage: bind-mount the repo and run `npm run dev` (node --watch).
FROM deps AS dev
ENV NODE_ENV=development
WORKDIR /app
EXPOSE 9101
CMD ["sh", "-c", "npm install && npm run dev"]

FROM node:22-bookworm-slim AS run
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
EXPOSE 9101
USER node
CMD ["node", "src/index.js"]
