FROM node:20-slim

WORKDIR /app

# Install Python 3 and pip for analysis scripts
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip curl && \
    rm -rf /var/lib/apt/lists/*

# Install Python dependencies for analysis engine
RUN pip3 install --no-cache-dir --break-system-packages boto3 anthropic

# Install root-level Node dependencies (AWS SDK for watcher)
COPY package.json ./
RUN npm install --production

# Install presenter Node dependencies
COPY presenter/package.json presenter/package-lock.json presenter/
RUN cd presenter && npm ci --production

# Copy all source files
COPY . .

# Presenter on 3000, WebSocket on 3001
EXPOSE 3000 3001

# Start both the presenter server and the analysis watcher.
# If either process exits, the container exits so orchestration can restart it.
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh
CMD ["/app/entrypoint.sh"]
