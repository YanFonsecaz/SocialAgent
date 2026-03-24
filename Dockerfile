FROM oven/bun:1.3.9

WORKDIR /app

# Install backend deps first (better caching)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Install frontend deps
COPY front-end/package.json front-end/bun.lock ./front-end/
RUN bun install --cwd front-end --frozen-lockfile

# Copy the rest of the repo
COPY . .

# Build frontend + backend bundle
RUN bun run build:all
RUN chmod +x scripts/start-with-migrations.sh

ENV NODE_ENV=production
ENV PORT=3333

EXPOSE 3333

# Ensure schema is current before the web process starts.
CMD ["./scripts/start-with-migrations.sh"]
