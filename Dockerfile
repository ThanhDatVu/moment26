FROM node:24-alpine
WORKDIR /app
COPY package.json server.js ./
USER node
ENV HOST=0.0.0.0
EXPOSE 3000
CMD ["node", "server.js"]
