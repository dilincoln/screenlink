# ScreenLink server. No dependencies to install: bun:sqlite is built into Bun.
FROM oven/bun:1.4.4-alpine

WORKDIR /app
COPY server/db.ts server/tree.ts server/index.ts ./server/

RUN mkdir -p /data && chown bun:bun /data
USER bun

ENV PORT=3000 \
    DB_FILE=/data/screenlink.sqlite
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:' + process.env.PORT + '/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["bun", "server/index.ts"]
