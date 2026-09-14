# Manual agentic upload entry — implementation plan

**Goal:** добавить в текущую агентскую систему отдельную n8n-форму, через которую Дмитрий может вручную передать документы закупки и запустить тот же конвейер подготовки, агентского анализа, финализации и отчёта, который уже работает для TenderPlan.

**Architecture:** форма принимает метаданные закупки и binary-файлы, проверяет только входной контракт и безопасность файлов, последовательно сохраняет исходники во внутреннем временном хранилище и затем передаёт стандартный `attachments[]` существующему workflow подготовки документов. После успешной подготовки новый `analysis_run` и все документы регистрируются одной транзакцией, и только затем вызывается существующий Agentic Dispatch. Содержимое документов в n8n не разбирается: способ исследования выбирает Codex.

## Task 1. Безопасное временное хранение ручных исходников

**Files:**

- Modify: `deploy/archive-extractor/src/config.mjs`
- Modify: `deploy/archive-extractor/src/server.mjs`
- Create: `deploy/archive-extractor/src/source-upload.mjs`
- Modify: `tests/archive-extractor-http.test.mjs`
- Create: `tests/archive-extractor-source-upload.test.mjs`

1. Сначала добавить failing-тесты на streaming upload, SHA-256, безопасное имя, allow-list форматов, лимит размера и идемпотентность.
2. Добавить внутренний `POST /v1/source-files/:job_id`, который сохраняет один исходный файл как artifact существующего store и возвращает `download_url` без binary/base64.
3. Разрешить только документные, табличные, текстовые, графические и архивные расширения; executable/script форматы и неизвестные расширения отклонять.
4. Прогнать unit/HTTP/deployment тесты archive-extractor.

## Task 2. Расширить общий документный контракт без семантических парсеров

**Files:**

- Modify: `workflows/n8n-exports/TENDER — Подготовить документацию.json`
- Modify: `tests/document-preparation-workflow.test.mjs`

1. Добавить failing regression на разрешённые изображения и текстовые/табличные форматы.
2. Расширить только allow-list прямых документов и MIME metadata.
3. Сохранить текущую обработку архивов, хэширование и fail-closed регистрацию без анализа содержимого.

## Task 3. Новый workflow ручной загрузки

**Files:**

- Create: `workflows/n8n-exports/TENDER — Ручная загрузка закупки.json`
- Create: `workflows/manual-upload.md`
- Create: `tests/manual-upload-workflow.test.mjs`

1. Получить точные типы Form Trigger, Code, Loop Over Items, HTTP Request, Execute Workflow, Postgres и Form Completion из установленной версии n8n.
2. Добавить failing contract-тесты: суммарно не более 200 MiB, минимум один файл, allow-list, отсутствие executable, последовательная передача binary, вызов существующей подготовки, атомарная регистрация до Agentic Dispatch, отсутствие pinned/mock data и секретов.
3. Создать workflow с полями `Название закупки`, необязательным `Номер закупки`, необязательным комментарием и множественной загрузкой файлов.
4. Использовать `source='manual_upload'`; хранить пользовательские метаданные в audit payload, но не binary.
5. Подключить общий error workflow и понятную финальную страницу с `analysis_run_id`.

## Task 4. Документация и regression

**Files:**

- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `ARCHITECTURE.md`
- Modify: `PROJECT_STATUS.md`
- Modify: `DEVELOPMENT_LOG.md`
- Modify: `deploy/archive-extractor/README.md`

1. Зафиксировать новую точку входа и границы ответственности.
2. Указать серверный лимит формы `N8N_FORMDATA_FILE_SIZE_MAX=200` и внутренний TTL исходников.
3. Выполнить полный релевантный regression suite и проверить отсутствие credentials в diff.

## Task 5. Live n8n и слепой тест 2

1. Развернуть только обновлённый внутренний archive-extractor и проверить health из n8n main/worker контейнеров.
2. Создать и валидировать новый workflow в n8n, опубликовать его и сверить опубликованную версию.
3. Передать через production form документы Blind Test 2, подтвердить создание run, регистрацию всех файлов и запуск Codex по live execution/DB.
4. Не ждать окончания длительного анализа для признания самого входа рабочим; дальнейший результат отслеживается существующим monitor workflow.
5. После verification закоммитить ветку `codex/manual-upload-entry` и отправить её на GitHub.
