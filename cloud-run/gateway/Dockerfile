FROM node:22-bookworm-slim
WORKDIR /app
COPY server.mjs ./server.mjs
ENV NODE_ENV=production
USER node
CMD ["node", "server.mjs"]
