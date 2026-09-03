# Middleware + Extension-Statik in einem Image (Same-Origin, kein CORS).
# Build-Kontext: Repo-Root (npm workspaces).
FROM node:24-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/extension/package.json packages/extension/
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e
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
