FROM node:22-bookworm-slim AS build
WORKDIR /build
RUN apt-get update \
 && apt-get install --no-install-recommends -y python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY . .
# The UI config and Vitest must resolve the same Vite types in this build.
RUN --mount=type=cache,target=/root/.npm npm pkg set devDependencies.vitest=4.0.18 devDependencies.vite=6.4.6 \
 && if [ -f apps/ui/package.json ]; then npm pkg set devDependencies.vite=6.4.6 -w @courtplus/ui; fi \
 && npm install --no-audit --no-fund \
 && npm run build -w @courtplus/contracts \
 && npm run build -w @courtplus/engine
RUN if [ -f packages/export/package.json ]; then npm run build -w @courtplus/export; fi \
 && if [ -f apps/ui/package.json ]; then npm run build -w @courtplus/ui; fi
RUN npm run build -w @courtplus/appliance

FROM build AS test
RUN npm test -w @courtplus/appliance

FROM build AS production
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund \
 && mkdir -p /runtime/apps/ui/dist /runtime/apps/appliance /runtime/packages \
 && cp -a node_modules package.json data /runtime/ \
 && for workspace in packages/*; do \
      if [ -d "$workspace/dist" ]; then \
        mkdir "/runtime/$workspace" && cp -a "$workspace/package.json" "$workspace/dist" "/runtime/$workspace/"; \
      fi; \
    done \
 && cp -a apps/appliance/package.json apps/appliance/dist apps/appliance/web /runtime/apps/appliance/ \
 && if [ -d apps/ui/dist ]; then cp -a apps/ui/dist/. /runtime/apps/ui/dist/; fi

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /srv/courtplus
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install --no-install-recommends -y chromium \
 && rm -rf /var/lib/apt/lists/* \
 && install -d -o node -g node -m 0700 /var/lib/courtplus
COPY --from=production --chown=node:node /runtime/ ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/appliance/dist/main.js"]
