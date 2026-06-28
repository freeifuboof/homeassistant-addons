FROM node:22-alpine

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN npm install -g mysa2mqtt \
    && npm cache clean --force

COPY run.sh /
RUN chmod a+x /run.sh

CMD ["/run.sh"]
