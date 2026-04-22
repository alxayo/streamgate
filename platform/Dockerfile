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

# Generate Prisma client
RUN cd platform && npx prisma generate

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

WORKDIR /app/platform

# Entrypoint runs Prisma migrations before starting the server
COPY platform/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000

CMD ["./docker-entrypoint.sh"]
