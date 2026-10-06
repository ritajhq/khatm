FROM denoland/deno:alpine-2.9.7

WORKDIR /app

COPY --from=orchestrator main.js orchestrator/main.js
COPY --from=worker main.js worker/main.js
COPY --from=login . login
COPY --from=cli main.js cli/main.js
RUN printf '#!/bin/sh\nexec deno run -A /app/cli/main.js "$@"\n' > /usr/local/bin/khatm \
  && chmod +x /usr/local/bin/khatm

ENV KHATM_PORT=4100 \
    KHATM_WORKER_ENTRY=/app/worker/main.js \
    KHATM_LOGIN_DIST=/app/login

COPY manifest.json /config/manifest.json

EXPOSE 4100

CMD ["deno", "run", "-A", "orchestrator/main.js"]
