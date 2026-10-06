FROM denoland/deno:alpine-2.9.7

WORKDIR /app

COPY --from=demo/partner main.js main.js

EXPOSE 9200

CMD ["deno", "run", "--allow-net", "--allow-env", "main.js"]
