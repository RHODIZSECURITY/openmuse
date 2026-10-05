# Build and runtime use the same immutable official Node 24 image.
FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS tooling
ENV PATH="/pnpm/bin:$PATH"
RUN npm install --global --prefix /pnpm --ignore-scripts --no-audit --no-fund pnpm@11.19.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/mobile/package.json ./apps/mobile/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY patches ./patches
# Do not copy a developer .npmrc or its possible credentials into an image layer.
RUN printf 'auto-install-peers=false\nstrict-peer-dependencies=false\n' > .npmrc

FROM tooling AS dependencies
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
ARG WEB_BASE_PATH=/muse
ENV EXPO_PUBLIC_WEB_BASE_PATH=$WEB_BASE_PATH \
    EXPO_NO_DOTENV=1 EXPO_NO_TELEMETRY=1 CI=1
COPY tsconfig.json tsconfig.build.json ./
COPY apps/server ./apps/server
COPY apps/mobile ./apps/mobile
COPY packages ./packages
COPY assets ./assets
COPY infra/write-web-manifest.mjs ./infra/write-web-manifest.mjs
RUN pnpm build:server && pnpm build:web:rhodiz

FROM tooling AS production-dependencies
RUN pnpm --filter openmuse --prod install --frozen-lockfile

FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS runtime
WORKDIR /app
ENV NODE_ENV=production WORKSPACE_MODE=live \
    OPENMUSE_DEPLOYMENT=rhodiz AUTH_BACKEND=rhodiz AGENT_BACKEND=agui \
    HOST=0.0.0.0 PORT=8787 DATA_DIR=/data OPENMUSE_WEB_DIR=/app/web \
    TASK_WORKER_ENABLED=false COMPUTER_ENABLED=false ALLOWED_ORIGINS="" \
    TOKEN_ENCRYPTION_KEY_FILE=/run/secrets/openmuse_encryption_key \
    DO_NOT_TRACK=1 COPILOTKIT_TELEMETRY_DISABLED=true
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/apps/mobile/dist/web ./web
COPY package.json LICENSE ./
RUN mkdir /data && chown node:node /data && chmod 700 /data
USER node
EXPOSE 8787
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:8787/api/health',{signal:AbortSignal.timeout(4000)}).then(async r=>{const x=await r.json();process.exit(r.ok&&x.ok&&x.mode==='live'&&x.authBackend==='rhodiz'&&x.agentConfigured?0:1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/apps/server/src/index.js"]
