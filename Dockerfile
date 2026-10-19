# Multi-stage production Dockerfile for AMAL Zeeshan WhatsApp Assistant
# Optimized for Google Cloud Run (Node.js 22 LTS, listens on process.env.PORT, 0.0.0.0)

FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package.json package-lock.json ./

# Deterministically install all dependencies for build
RUN npm ci

# Copy source code and config files
COPY . .

# Build production frontend bundle into /dist
RUN npm run build

# --- Production Runner Stage ---
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# Copy package manifests and install only production dependencies + tsx runner
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm install tsx@^4.21.0

# Copy built frontend from builder
COPY --from=builder /app/dist ./dist

# Copy server code and data logic
COPY server.ts ./
COPY src ./src
COPY tsconfig.json ./

# Cloud Run defaults to container port 8080 or process.env.PORT
EXPOSE 8080

# Start production server using tsx
CMD ["npm", "start"]
