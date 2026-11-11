# syntax=docker/dockerfile:1

# 1) Build the panel (static SPA bundle)
FROM oven/bun:1.4.3-debian AS panel
WORKDIR /build
COPY package.json bun.lock ./
COPY apps/panel/package.json ./apps/panel/package.json
COPY apps/server/package.json ./apps/server/package.json
RUN bun install --frozen-lockfile --ignore-scripts
COPY apps/panel/ ./apps/panel/
RUN bun run panel:build

# 2) Production dependencies from the workspace root lockfile
FROM oven/bun:1.4.3-debian AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/panel/package.json ./apps/panel/package.json
COPY apps/server/package.json ./apps/server/package.json
RUN bun install --production --frozen-lockfile --ignore-scripts

# 3) Runtime
FROM oven/bun:1.4.3-debian
# Application release identity, independent of the pinned Bun runtime version.
ARG STYX_VERSION=dev
LABEL org.opencontainers.image.title="StyxRouter" \
      org.opencontainers.image.version="${STYX_VERSION}"
ENV NODE_ENV=production \
    PORT=20128 \
    DATA_DIR=/data
WORKDIR /app/apps/server
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/apps/server/node_modules ./node_modules
COPY apps/server/ ./
# Preserve root lineage and every retained legal/asset notice in the artifact.
COPY LICENSE CREDITS.md /app/
COPY apps/panel/src/components/provider-icon-NOTICE.md /app/notices/provider-icon-NOTICE.md
COPY --from=panel /build/apps/panel/dist ./panel
RUN mkdir -p /data && chown -R bun:bun /data /app
USER bun
VOLUME /data
EXPOSE 20128
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||20128)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "server/styx.ts"]
