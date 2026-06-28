FROM node:22-alpine

RUN apk add --no-cache bash

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN npm install -g mysa2mqtt \
    && npm cache clean --force

COPY run.sh /run.sh
RUN chmod +x /run.sh

CMD ["/run.sh"]
