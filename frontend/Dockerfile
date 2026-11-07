FROM smart-reservoir-node-red:latest

WORKDIR /app

COPY dist ./dist
COPY static-server.mjs ./static-server.mjs

EXPOSE 5173

ENTRYPOINT []
CMD ["node", "static-server.mjs"]
