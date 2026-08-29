FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY package-lock.json ./
RUN npm ci --omit=dev
COPY server/ ./server/
COPY public/ ./public/
EXPOSE 3000
VOLUME /data
CMD ["node", "server/index.js"]
