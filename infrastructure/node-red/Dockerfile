FROM smart-reservoir-node-red:latest

COPY flows.json /data/flows.json
COPY flows_cred.json /data/flows_cred.json
COPY settings.js /data/settings.js
COPY local-postgresql /data/node_modules/node-red-contrib-local-postgresql

USER node-red
