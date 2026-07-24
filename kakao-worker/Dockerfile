# Playwright's official image ships Chromium + all OS deps preinstalled,
# matched to the playwright npm version below.
FROM mcr.microsoft.com/playwright:v1.49.0-jammy

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

ENV NODE_ENV=production
# Render/Railway inject PORT; default to 3000 locally.
EXPOSE 3000
CMD ["node", "server.js"]
