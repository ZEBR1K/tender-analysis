FROM node:24.18.0-bookworm-slim

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
      "poppler-utils=22.12.0-2+deb12u3" \
      "libreoffice-core=4:7.4.7-1+deb12u14" \
      "libreoffice-writer=4:7.4.7-1+deb12u14" \
      "libreoffice-calc=4:7.4.7-1+deb12u14" \
      "tesseract-ocr=5.3.0-2" \
      "tesseract-ocr-eng=1:4.1.0-2" \
      "tesseract-ocr-rus=1:4.1.0-2" \
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
COPY src ./src

RUN mkdir --parents /data/jobs/.tmp \
    && chown --recursive 10001:10001 /data/jobs

ENV HOME=/run/codex-auth \
    CODEX_HOME=/run/codex-auth \
    TMPDIR=/data/jobs/.tmp

USER 10001:10001

CMD ["node", "src/server.mjs"]
