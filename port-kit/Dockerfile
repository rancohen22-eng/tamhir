# Build context must be the port-kit/ directory:  docker build -f Dockerfile -t arkia-bookings .
FROM node:20-alpine
WORKDIR /app
COPY server/package.json server/package.json
RUN cd server && npm install --omit=dev
COPY server/ server/
COPY spa/ spa/
WORKDIR /app/server
EXPOSE 8080
CMD ["node", "src/server.js"]
