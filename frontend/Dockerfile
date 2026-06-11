# Stage 1: Build client and server bundles
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --legacy-peer-deps
COPY . .
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN npm run build

# Stage 2: Runtime image
FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/.output ./.output

EXPOSE 8080
ENV HOST=0.0.0.0
ENV PORT=8080

CMD ["node", ".output/server/index.mjs"]
