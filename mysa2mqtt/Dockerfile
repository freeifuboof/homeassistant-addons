FROM node:22-alpine

WORKDIR /app

RUN npm install -g mysa2mqtt \
    && npm cache clean --force

COPY run.sh /run.sh
RUN chmod +x /run.sh

CMD ["/run.sh"]
