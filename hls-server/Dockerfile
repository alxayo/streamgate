FROM node:20-alpine AS base

WORKDIR /app

# Copy workspace root config
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/ ./shared/
COPY hls-server/package.json ./hls-server/

# Create stub for platform workspace so npm ci can resolve all workspaces
COPY platform/package.json ./platform/package.json

# Install all workspace dependencies
RUN npm ci

# Build shared package first
RUN cd shared && npx tsc

# Copy source
COPY hls-server/ ./hls-server/

# Build TypeScript
RUN cd hls-server && npm run build

# Production image
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=base /app/package.json ./
COPY --from=base /app/package-lock.json ./
COPY --from=base /app/shared/package.json ./shared/package.json
COPY --from=base /app/shared/dist/ ./shared/dist/
COPY --from=base /app/hls-server/dist/ ./hls-server/dist/
COPY --from=base /app/hls-server/package.json ./hls-server/
COPY --from=base /app/node_modules/ ./node_modules/

# Override shared main to point to compiled output
RUN cd shared && sed -i 's|./src/index.ts|./dist/index.js|g' package.json

WORKDIR /app/hls-server

ENV NODE_PATH=/app/node_modules

EXPOSE 4000

CMD ["node", "dist/index.js"]
