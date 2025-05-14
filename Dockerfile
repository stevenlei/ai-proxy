# syntax=docker/dockerfile:1

# Build Stage
FROM node:22-slim AS builder
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application source code
COPY . .

# Build the TypeScript project
# Assumes you have a "build" script in your package.json, e.g., "tsc -p tsconfig.json"
RUN npm run build

# Production Stage
FROM node:22-slim AS production
WORKDIR /app

RUN apt-get update && apt-get install -y \
    curl

# Copy package.json
COPY package.json ./

# Install production dependencies only
RUN npm install --omit=dev

# Copy built code from the builder stage
COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
ENV PORT=3000

# Command to run the application
# Assumes your entry point after build is dist/main.js
CMD ["npm", "start"]