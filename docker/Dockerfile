# Node runtime image (SPEC §13.3, ADR-0004). Build from the repo root:
#   docker build -f docker/Dockerfile .

FROM node:22-bookworm-slim AS base
WORKDIR /app

# Only the workspace manifests, so `npm ci` stays cached until dependencies change.
FROM base AS manifests
COPY . /src
RUN cd /src && find . -name package.json -not -path "*/node_modules/*" -print0 \
    | xargs -0 tar -cf /manifests.tar package-lock.json

# better-sqlite3 ships prebuilt binaries (linux amd64 and arm64) and esbuild installs its binary as
# an optional package, so install scripts (a node-gyp rebuild) are skipped and no compiler is needed.
FROM base AS deps
COPY --from=manifests /manifests.tar /tmp/
RUN tar -xf /tmp/manifests.tar \
    && npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

FROM base
ENV NODE_ENV=production \
    DATABASE_PATH=/data/denarii.db \
    PORT=3000
# Includes the nested node_modules of workspaces, not only the root one.
COPY --from=deps /app ./
COPY . .
# A named volume mounted on /data starts with this ownership.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
WORKDIR /app/apps/node
# Same as `npm start -w @denarii/node`, without npm in between so SIGTERM reaches the app.
CMD ["node", "--import", "tsx", "--import", "./src/register.mjs", "src/main.ts"]
