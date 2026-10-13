FROM node:24-alpine

WORKDIR /app

# Pinned: 2.0.0+ re-authenticates with credentials instead of a persisted
# session file, so an expired refresh token no longer crashes the add-on.
RUN npm install -g mysa2mqtt@3.2.7 \
    && npm cache clean --force

COPY run.sh /run.sh
RUN chmod +x /run.sh

CMD ["/run.sh"]
