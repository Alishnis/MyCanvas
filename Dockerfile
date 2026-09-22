# Zero-dependency Node app — no install step needed.
FROM node:20-alpine

WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY public ./public

# Container-internal port; map/publish it however the host needs.
ENV PORT=5173
# Bind to all interfaces inside the container — the container boundary
# (Docker's own network isolation / whatever port you publish) is what
# controls actual exposure, unlike the bare-metal default of 127.0.0.1.
ENV HOST=0.0.0.0

EXPOSE 5173

RUN addgroup -S app && adduser -S app -G app
USER app

CMD ["node", "server.js"]
