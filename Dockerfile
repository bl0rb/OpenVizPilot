# Middleware + Extension-Statik in einem Image (Same-Origin, kein CORS).
# Build-Kontext: Repo-Root (npm workspaces).
FROM node:24-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/extension/package.json packages/extension/
COPY ee/package.json ee/
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
# Release-Version aus dem Publish-Workflow (Git-Tag); Helm und Compose setzen sie zusätzlich per Env.
ARG OVP_APP_VERSION=unbekannt
ENV OVP_APP_VERSION=$OVP_APP_VERSION
ENV NODE_ENV=production
WORKDIR /app
# Server ist per tsup vollständig gebündelt (inkl. Dependencies) — keine node_modules nötig.
COPY --from=build /app/packages/server/dist ./dist
COPY --from=build /app/packages/extension/dist ./public
ENV PORT=3000
ENV OVP_SERVE_STATIC_DIR=./public
EXPOSE 3000
USER node
CMD ["node", "dist/index.js"]
