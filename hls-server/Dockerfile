FROM node:20-alpine AS base

WORKDIR /app

# Copy workspace root config
COPY package.json package-lock.json ./
COPY shared/ ./shared/
COPY hls-server/package.json ./hls-server/

# Install dependencies
RUN npm ci --workspace=@streaming/hls-server

# Copy source
COPY hls-server/ ./hls-server/

# Build TypeScript
RUN cd hls-server && npm run build

# Production image
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=base /app/package.json ./
COPY --from=base /app/shared/ ./shared/
COPY --from=base /app/hls-server/dist/ ./hls-server/dist/
COPY --from=base /app/hls-server/package.json ./hls-server/
COPY --from=base /app/node_modules/ ./node_modules/

WORKDIR /app/hls-server

EXPOSE 4000

CMD ["node", "dist/index.js"]
