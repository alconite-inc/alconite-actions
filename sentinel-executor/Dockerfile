FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS builder

WORKDIR /source
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY scripts ./scripts
COPY src ./src
COPY impact ./impact
COPY runtime-verify ./runtime-verify
COPY sentinel-executor ./sentinel-executor
RUN npm run build \
    && install -d -m 0755 -o 65532 -g 65532 /image-root/workspace /image-root/reports

FROM cgr.dev/chainguard/glibc-dynamic:latest@sha256:d0046044cd28948d3380eb0d98709dc7e63f98161fe7105135e1025650bad17a

ARG IMAGE_VERSION=2.4.1
ARG IMAGE_REVISION=unknown
ARG IMAGE_CREATED=unknown
LABEL org.opencontainers.image.title="Alconite Sentinel Executor" \
      org.opencontainers.image.description="Portable Contract Guard, Impact, and Runtime Verify executor" \
      org.opencontainers.image.source="https://github.com/alconite-inc/alconite-actions" \
      org.opencontainers.image.documentation="https://github.com/alconite-inc/alconite-actions#sentinel-container" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.version="${IMAGE_VERSION}" \
      org.opencontainers.image.revision="${IMAGE_REVISION}" \
      org.opencontainers.image.created="${IMAGE_CREATED}"

COPY --from=builder --chown=65532:65532 /image-root/workspace /workspace
COPY --from=builder --chown=65532:65532 /image-root/reports /reports
COPY --from=builder /usr/local/bin/node /nodejs/bin/node
COPY --from=builder --chown=65532:65532 /source/dist/*.js /opt/sentinel/dist/
COPY --from=builder --chown=65532:65532 /source/impact/dist/index.js /opt/sentinel/impact/dist/index.js
COPY --from=builder --chown=65532:65532 /source/runtime-verify/dist/index.js /opt/sentinel/runtime-verify/dist/index.js
COPY --from=builder --chown=65532:65532 /source/sentinel-executor/dist/index.js /opt/sentinel/sentinel-executor/dist/index.js
COPY --chown=65532:65532 LICENSE /opt/sentinel/LICENSE

WORKDIR /workspace
USER 65532:65532
ENTRYPOINT ["/nodejs/bin/node", "/opt/sentinel/sentinel-executor/dist/index.js"]
