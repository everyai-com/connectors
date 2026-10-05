FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev || npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
ENV PORT=3011
EXPOSE 3000
CMD ["node", "dist/index.js"]
