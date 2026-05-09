# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Final stage
FROM node:20-alpine

WORKDIR /app

# Copy only the necessary files from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/config ./config

# Expose backend port
EXPOSE 5000

# Start the application
CMD ["npm", "run", "start"]
