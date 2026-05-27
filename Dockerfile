FROM node:20-slim

# Install LibreOffice Impress for PPTX rendering + common fonts
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-impress \
    fonts-liberation \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install mirror-app dependencies (sharp, pptxgenjs, mupdf, pdf-lib)
COPY mirror-app/package*.json ./mirror-app/
RUN cd mirror-app && npm ci --omit=dev

# Install ios-version dependencies (express, multer)
COPY ios-version/package*.json ./ios-version/
RUN cd ios-version && npm ci --omit=dev

# Copy source files
COPY mirror-app/ ./mirror-app/
COPY ios-version/ ./ios-version/

WORKDIR /app/ios-version

# Render sets PORT automatically; default to 3000 for local docker run
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
