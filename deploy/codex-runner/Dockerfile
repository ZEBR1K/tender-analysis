FROM node:24.18.0-bookworm-slim

ADD --checksum=sha256:fd0e8f8f2408dd2e5b90286e60f3f97cf566ba441cd48cfc5bcc68067303e0bc \
  https://download.documentfoundation.org/libreoffice/stable/26.2.6/deb/x86_64/LibreOffice_26.2.6_Linux_x86-64_deb.tar.gz \
  /tmp/libreoffice.tar.gz

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
      "ca-certificates=20250419~deb12u1" \
      "libcups2=2.4.2-3+deb12u9" \
      "libdbus-1-3=1.14.10-1~deb12u1" \
      "libice6=2:1.0.10-1" \
      "libsm6=2:1.2.3-1" \
      "libx11-xcb1=2:1.8.4-2+deb12u2" \
      "libxinerama1=2:1.1.4-3" \
      "libxrandr2=2:1.5.2-2+b1" \
      "libxt6=1:1.2.1-1.1" \
      "poppler-utils=22.12.0-2+deb12u3" \
      "tesseract-ocr=5.3.0-2" \
      "tesseract-ocr-eng=1:4.1.0-2" \
      "tesseract-ocr-rus=1:4.1.0-2" \
      "unzip=6.0-28+deb12u1" \
      "util-linux=2.38.1-5+deb12u3" \
    && mkdir --parents /tmp/libreoffice \
    && tar --extract --gzip --file /tmp/libreoffice.tar.gz --directory /tmp/libreoffice \
    && apt-get install --yes --no-install-recommends /tmp/libreoffice/LibreOffice_*/DEBS/*.deb \
    && ln --symbolic /opt/libreoffice26.2/program/soffice /usr/local/bin/libreoffice \
    && ln --symbolic /opt/libreoffice26.2/program/soffice /usr/local/bin/soffice \
    && libreoffice --version | grep --fixed-strings 'LibreOffice 26.2.6.3' \
    && rm --recursive --force /tmp/libreoffice /tmp/libreoffice.tar.gz \
    && rm -rf /var/lib/apt/lists/*

RUN npm install --global --ignore-scripts @openai/codex@0.153.4

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY schemas ./schemas
COPY policies ./policies
COPY field-catalog ./field-catalog
COPY agent-template ./agent-template
COPY prompts ./prompts
COPY probes ./probes
COPY src ./src

RUN mkdir --parents /data/jobs/.tmp \
    && chown --recursive 10001:10001 /data/jobs

ENV HOME=/run/codex-auth \
    CODEX_HOME=/run/codex-auth \
    TMPDIR=/data/jobs/.tmp

USER 10001:10001

CMD ["node", "src/server.mjs"]
