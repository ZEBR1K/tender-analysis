FROM node:22.23.2-bookworm-slim

ARG SEVEN_ZIP_URL=https://github.com/ip7z/7zip/releases/download/26.03/7z2603-linux-x64.tar.xz
ARG SEVEN_ZIP_SHA256=dc99eff5008f1ab79bd7084c68513701547a808a89502bf4133683535ab3c695

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates curl xz-utils \
    && rm -rf /var/lib/apt/lists/* \
    && curl --fail --show-error --location "$SEVEN_ZIP_URL" --output /tmp/7zip.tar.xz \
    && echo "$SEVEN_ZIP_SHA256  /tmp/7zip.tar.xz" | sha256sum -c - \
    && tar --extract --xz --file /tmp/7zip.tar.xz --directory /usr/local/bin 7zz \
    && chmod 0755 /usr/local/bin/7zz \
    && rm /tmp/7zip.tar.xz

WORKDIR /app
COPY package.json ./package.json
COPY src ./src

RUN mkdir --parents /var/lib/archive-extractor \
    && chown --recursive 10001:10001 /var/lib/archive-extractor

USER 10001:10001

CMD ["node", "src/server.mjs"]
