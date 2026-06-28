ARG BUILD_FROM
FROM ${BUILD_FROM}

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN apk add --no-cache nodejs-current npm

RUN node -v \
    && npm -v \
    && npm install -g mysa2mqtt \
    && npm cache clean --force

COPY run.sh /
RUN chmod a+x /run.sh

CMD ["/run.sh"]
