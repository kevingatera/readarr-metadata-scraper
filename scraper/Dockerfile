FROM node:18-alpine
RUN mkdir -p /opt/app /opt/app/cache
WORKDIR /opt/app
COPY package.json .
COPY package-lock.json .
COPY certs/ ./certs
RUN npm install
COPY src/ ./src
EXPOSE 80 443
ENV CACHE_DIR=/opt/app/cache
CMD [ "npm", "start"]