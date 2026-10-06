FROM denoland/deno:alpine-2.9.7

WORKDIR /app

COPY --from=demo/service main.js main.js

EXPOSE 9100

CMD ["deno", "run", "--allow-net", "--allow-env", "main.js"]
