# SleekBoard API image for Cloud Run. Two stages: the first builds Prisma's database client from prisma/schema.prisma
# (that needs the prisma tool, a dev dependency), the second is the image that runs, with production packages only.

# ---- Build the Prisma client ----
FROM node:22-alpine AS prisma

WORKDIR /app

# Every package, dev ones too, since `prisma generate` comes from the prisma dev dependency.
COPY package.json package-lock.json ./
RUN npm ci

# Generating needs the schema and the config, not a database: no DATABASE_URL is set here, and none is needed.
COPY prisma ./prisma
COPY prisma.config.js ./
RUN npx prisma generate

# ---- The image that runs ----
FROM node:22-alpine

WORKDIR /app

# Install deps first so Docker reuses this layer when only src/ changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# The client Prisma wrote, as TypeScript. Node 22 loads it as it is (type stripping, on by default since 22.18).
COPY --from=prisma /app/generated ./generated
COPY src ./src

# Cloud Run sends traffic from outside the container, so listen on every
# interface. It also sets PORT itself; 8080 is only the fallback.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080

EXPOSE 8080

# The node image ships a non-root user; no reason to run as root.
USER node

# Migrations don't run here: the server connects as sleekboard_app, which can't change tables. They run as
# sleekboard_owner, before a deploy (see prisma/roles.sql).
CMD ["node", "src/server.js"]
