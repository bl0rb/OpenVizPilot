# Middleware + Extension-Statik in einem Image (Same-Origin, kein CORS).
# Build-Kontext: Repo-Root (npm workspaces).
FROM node:24-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/extension/package.json packages/extension/
COPY ee/package.json ee/
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553
ENV NODE_ENV=production
WORKDIR /app
# Server ist per tsup vollständig gebündelt (inkl. Dependencies) — keine node_modules nötig.
COPY --from=build /app/packages/server/dist ./dist
COPY --from=build /app/packages/extension/dist ./public
ENV PORT=3000
ENV SERVE_STATIC_DIR=./public
EXPOSE 3000
USER node
CMD ["node", "dist/index.js"]
