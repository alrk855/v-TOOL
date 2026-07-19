FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY services/dashboard/package.json services/dashboard/package.json
RUN npm install --workspace services/dashboard --include-workspace-root

FROM deps AS build
COPY services/dashboard services/dashboard
RUN npm run build -w services/dashboard

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/services/dashboard/dist ./services/dashboard/dist
COPY --from=build /app/services/dashboard/src/public ./services/dashboard/src/public
COPY --from=build /app/services/dashboard/src/db/migrations ./services/dashboard/src/db/migrations
WORKDIR /app/services/dashboard
EXPOSE 3000
CMD ["node", "dist/server.js"]
