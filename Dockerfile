# Variaq production image: multi-stage build, Next.js standalone output, non-root runtime.
# Build:  docker build -t variaq .
# Run:    docker compose up -d   (see docker-compose.yml for the multi-instance setup)

FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN apk add --no-cache libc6-compat tini \
 && addgroup -S variaq -g 1001 && adduser -S variaq -u 1001 -G variaq \
 && mkdir -p /app/data && chown variaq:variaq /app/data
# Standalone server + static assets.
COPY --from=build --chown=variaq:variaq /app/.next/standalone ./
COPY --from=build --chown=variaq:variaq /app/.next/static ./.next/static
COPY --from=build --chown=variaq:variaq /app/public ./public
# The background worker runs from the same image (`node scripts/worker.js`), so ship lib + scripts + deps it needs.
COPY --from=build --chown=variaq:variaq /app/lib ./lib
COPY --from=build --chown=variaq:variaq /app/scripts ./scripts
COPY --from=deps --chown=variaq:variaq /app/node_modules ./node_modules
USER variaq
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
