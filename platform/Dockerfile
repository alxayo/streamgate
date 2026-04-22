FROM node:20-alpine AS base

WORKDIR /app

# Copy workspace root config
COPY package.json package-lock.json ./
COPY shared/ ./shared/
COPY platform/package.json ./platform/

# Install dependencies
RUN npm ci --workspace=@streaming/platform

# Copy platform source
COPY platform/ ./platform/

# Generate Prisma client (DATABASE_URL required at build time for config resolution)
RUN cd platform && DATABASE_URL=file:/tmp/build.db npx prisma generate

# Build Next.js
RUN cd platform && npm run build

# Production image
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=base /app/package.json ./
COPY --from=base /app/shared/ ./shared/
COPY --from=base /app/platform/ ./platform/
COPY --from=base /app/node_modules/ ./node_modules/

# Remove dev .env files so runtime uses Container Apps env vars, not stale build-time values
RUN rm -f ./platform/.env ./platform/.env.local ./.env ./.env.local

WORKDIR /app/platform

# Entrypoint runs Prisma migrations before starting the server
COPY platform/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000

CMD ["./docker-entrypoint.sh"]
