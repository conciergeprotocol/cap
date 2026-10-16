FROM node:24-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
ENV PORT=8088
ENV HOST=0.0.0.0
EXPOSE 8088
CMD ["node", "start.mjs"]
