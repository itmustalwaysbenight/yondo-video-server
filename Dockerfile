FROM node:18-slim

# Install required packages
RUN apt-get update && \
    apt-get install -y python3 python3-pip curl && \
    rm -rf /var/lib/apt/lists/*

# Install yt-dlp
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy app source
COPY . .

# Create temp directory
RUN mkdir -p temp && chmod 777 temp

# Expose port
EXPOSE 10000

# Start the server
CMD ["npm", "start"] 