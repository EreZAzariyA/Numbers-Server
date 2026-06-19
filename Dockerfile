# ── Stage 1: compile TypeScript ───────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /workspace/numbers-server

COPY package*.json ./

# Replace the local file: reference with the published npm version, then drop
# the lockfile so npm resolves fresh from the registry (no file: residue).
RUN npm pkg set dependencies["israeli-bank-scrapers-for-e.a-servers"]="^3.0.1" \
    && rm -f package-lock.json \
    && npm install --legacy-peer-deps

COPY . .
RUN npx tsc

# ── Stage 2: lean runtime image with Chromium for bank scrapers ───────────────
FROM node:22

# Chromium + Puppeteer system dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /workspace/numbers-server

COPY package*.json ./

RUN npm pkg set dependencies["israeli-bank-scrapers-for-e.a-servers"]="^3.0.1" \
    && rm -f package-lock.json \
    && npm install --omit=dev --legacy-peer-deps

# Copy compiled output from builder
COPY --from=builder /workspace/numbers-server/build ./build

EXPOSE 5000

CMD ["node", "build/src/app.js"]
