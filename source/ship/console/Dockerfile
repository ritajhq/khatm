FROM denoland/deno:alpine-2.9.7

WORKDIR /app

COPY --from=console/server main.js console/main.js
COPY --from=console/web . console/web
COPY --from=login . login

ENV PORT=4200 \
    KHATM_CONSOLE_DIST=/app/console/web \
    KHATM_LOGIN_DIST=/app/login

EXPOSE 4200

CMD ["deno", "run", "-A", "console/main.js"]
