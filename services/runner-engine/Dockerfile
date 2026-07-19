FROM mcr.microsoft.com/playwright:v1.49.1-noble AS deps
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY services/runner-engine/package.json services/runner-engine/package.json
RUN npm install --workspace services/runner-engine --include-workspace-root

FROM deps AS build
COPY services/runner-engine services/runner-engine
RUN npm run build -w services/runner-engine

FROM mcr.microsoft.com/playwright:v1.49.1-noble AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/services/runner-engine/dist ./services/runner-engine/dist
WORKDIR /app/services/runner-engine
CMD ["node", "dist/index.js"]
