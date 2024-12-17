FROM node:18-alpine
RUN mkdir -p /opt/app /opt/app/cache
WORKDIR /opt/app
RUN npm install -g pnpm
COPY package.json pnpm-lock.yaml ./
COPY certs/ ./certs
RUN pnpm install
COPY src/ ./src
EXPOSE 80 443
ENV NODE_ENV=production
ENV CACHE_DIR=/opt/app/cache
CMD [ "npm", "start"]