FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy application files
COPY server.js ./
COPY src ./src
COPY test-site ./test-site

# Expose port
EXPOSE 3000

# Set environment variables with defaults
ENV PORT=3000
ENV GA4_PROPERTY=G-XXXXXXXXXX
ENV SERVER_CONTAINER_URL=https://localhost:8888

# Start the server
CMD ["node", "server.js"]
