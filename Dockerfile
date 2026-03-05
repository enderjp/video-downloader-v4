FROM node:20-slim

# Ensure Puppeteer cache path matches runtime on Render
ENV NODE_ENV=production \
  PUPPETEER_CACHE_DIR=/opt/render/.cache/puppeteer \
  PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
  PUPPETEER_HEADLESS=new \
  PORT=3000

WORKDIR /app

    ca-certificates \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

# Install Puppeteer's Chromium into the cache dir at build time so the runtime
# image already contains the browser. This mirrors what Render's non-Docker
# builders do when running `npx puppeteer install` during build.
RUN mkdir -p $PUPPETEER_CACHE_DIR \
  && PUPPETEER_CACHE_DIR=$PUPPETEER_CACHE_DIR npx puppeteer@latest install chrome

COPY . .
