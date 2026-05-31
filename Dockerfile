# Use Node 20 slim as base
FROM node:20-slim

# Install FFmpeg and required fonts for subtitle rendering
RUN apt-get update && apt-get install -y \
    ffmpeg \
    fonts-liberation \
    fontconfig \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package.json ./
RUN npm install --production

# Copy server code
COPY server.js ./

# Create tmp directory
RUN mkdir -p /tmp/ffmpeg-jobs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start server
CMD ["node", "server.js"]
