FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package.json ./
COPY src ./src
USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=2s CMD wget -qO- http://localhost:8080/healthz || exit 1
CMD ["node", "src/server.js"]
