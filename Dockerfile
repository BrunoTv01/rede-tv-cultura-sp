FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3100 HOST=0.0.0.0
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund --loglevel=error
COPY server.js auth.js ./
COPY tools ./tools
COPY db ./db
COPY data ./data
COPY public ./public
USER node
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3100/api/health || exit 1
CMD ["node", "server.js"]
