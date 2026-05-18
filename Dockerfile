# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install

FROM deps AS api
ENV NODE_ENV=production
COPY server ./server
EXPOSE 3000
CMD ["npm", "run", "start:api"]

FROM deps AS web-build
COPY . .
RUN npm run build

FROM caddy:2-alpine AS web
COPY ops/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=web-build /app/dist /srv
EXPOSE 80 443
