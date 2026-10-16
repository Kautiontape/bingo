FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# better-sqlite3 ships prebuilt binaries (including musl), so its node-gyp script isn't needed.
RUN npm ci --omit=dev --ignore-scripts

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATABASE_URL=/data/bingo.db
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY public ./public
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "server/index.js"]
