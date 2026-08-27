# syntax=docker/dockerfile:1

# base-app API — NestJS backend, built as one deployable image.
#
# Postgres and Redis are NOT part of this build. Both are expected as existing services the
# container reaches over the network — see docker-compose.yml for how.

ARG NODE_IMAGE=node:26-alpine

##############################################################################
# 1. Dependencies — full install, because the build needs devDependencies
#    (nest-cli, typescript, prisma, tsc-alias). Its own stage so it caches
#    independently of source changes: editing a controller must not reinstall
#    node_modules.
##############################################################################
FROM ${NODE_IMAGE} AS deps
RUN apk add --no-cache libc6-compat python3 make g++ \
    && npm install --global yarn
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

##############################################################################
# 2. Build — generate the Prisma client, compile TypeScript, then rewrite the
#    "@/*" path aliases (tsc-alias) so the runtime stage can run plain
#    `node dist/main.js` with no path-mapping shim.
##############################################################################
FROM deps AS build
WORKDIR /app
COPY tsconfig.json tsconfig.build.json nest-cli.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
# `prisma generate` only reads prisma/schema.prisma — it never connects. It just needs
# DATABASE_URL to be *set*, because prisma.config.ts reads it via env(). The real value is
# supplied at container runtime, not baked in here.
ENV DATABASE_URL="postgresql://user:password@127.0.0.1:5432/db?schema=public"
RUN yarn db:gen
RUN yarn build

##############################################################################
# 3. Production node_modules — a clean install with devDependencies excluded.
#    Kept separate from stage 1 so none of the build tooling reaches the
#    runtime image.
##############################################################################
FROM ${NODE_IMAGE} AS prod-deps
RUN apk add --no-cache libc6-compat \
    && npm install --global yarn
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production=true

##############################################################################
# 4. Runtime
##############################################################################
FROM ${NODE_IMAGE} AS runtime

LABEL org.opencontainers.image.source="https://github.com/syedamirali/nestjs-starter-template"
LABEL org.opencontainers.image.description="base-app API — AI Career OS backend"
LABEL org.opencontainers.image.licenses="UNLICENSED"

# wget backs the HEALTHCHECK below; busybox wget is already present in alpine.
ENV NODE_ENV=production
WORKDIR /app

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
# main.ts does `require('../package.json')` for the startup banner version, so package.json
# must stay one level above dist/.
COPY --chown=node:node package.json ./
COPY --from=build --chown=node:node /app/dist ./dist
# The generated Prisma client is emitted into src/generated and compiled into dist, but the
# schema is still needed for `prisma migrate deploy` if the deploy runs it in-container.
COPY --chown=node:node prisma ./prisma

# Never root. The process needs to read its own code and nothing else.
USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider "http://127.0.0.1:${PORT:-4000}/health" || exit 1

CMD ["node", "dist/main.js"]
