# TENDER — Ручная загрузка закупки

**Тип:** production Form Trigger / дополнительный вход агентского контура

**Workflow ID в n8n:** `fB46LZnrNCs2MDeL`

**Production form:** `https://n8nworkup.ru/form/tender-manual-upload`

**Repository export:** `workflows/n8n-exports/TENDER — Ручная загрузка закупки.json`

## Назначение

Workflow позволяет запустить тот же агентский анализ без TenderPlan. Пользователь
указывает название закупки, при необходимости номер и комментарий, прикладывает
файлы и получает `analysis_run_id` после успешной регистрации и отправки в
agentic Dispatch.

```text
n8n Form
→ проверка имён, расширений и общего размера
→ последовательное сохранение исходных bytes
→ TENDER — Подготовить документацию
→ atomic analysis_run + 12/12-style document registration barrier
→ TENDER — Агентский анализ — Запуск
→ существующие Monitor → Finalization → Report
```

Это отдельный вход, а не отдельная система анализа. После регистрации документов
используются те же skill, runner, exact-27 JSON contract, Finalization и генерация
HTML/PDF, что и для TenderPlan.

## Вход

Обязательные поля формы:

- `Название закупки`;
- `Документы` — один или несколько файлов.

Необязательные поля:

- `Номер закупки`;
- `Комментарий`.

Для ручного запуска создаётся UUID `analysis_run_id`, а технический tender ID
имеет вид `manual:<analysis_run_id>`. В `tender_meta.source` сохраняется
`manual_upload`; исходный form payload содержит только metadata и SHA-256, но не
binary content. В `tender_meta.source_payload.n8n_execution_id` сохраняется ID
родительского form execution: он нужен только для точного ownership guard при
аварии после регистрации run.

## Доступ к форме

Сейчас Form Trigger использует `authentication=none`, то есть ссылка открывается
без учётной записи n8n. Это сохранено по принятому для MVP решению, но означает,
что любой получивший URL может запустить платный production-анализ и загрузить
до 200 MiB. До передачи ссылки за пределы доверенного круга форму нужно закрыть
через `n8n User Auth` либо внешний access-control слой.

## Допустимые файлы и лимиты

Напрямую принимаются:

```text
pdf / docx / xlsx / xls
txt / csv / tsv / md / json / xml / html / rtf
png / jpg / jpeg / tif / tiff / bmp / webp
```

Архивы:

```text
zip / 7z / rar / tar / gz / tar.gz / tgz
```

Ограничения:

```text
вся форма: 200 MiB
один обычный файл: 50 MiB
один архив: 100 MiB
```

Неизвестные расширения и исполняемые форматы не принимаются. Дополнительно
проверяется executable magic (`MZ`, ELF, shebang, Mach-O и Java class), поэтому
переименование executable в разрешённое расширение не обходит guard.

## Хранение и целостность

Каждый файл последовательно отправляется во внутренний
`tender-archive-extractor` через `POST /v1/source-files/:job_id`. Сервис пишет
bytes во временный файл с правами `0600`, считает SHA-256, атомарно фиксирует
artifact и возвращает `tender_manual_source_upload_v1`. Повторная передача тех
же bytes идемпотентна; изменённые bytes с тем же job ID дают
`JOB_INPUT_MISMATCH`.

Внутренние artifact URLs распознаются по точному префиксу
`http://tender-archive-extractor:8080/v1/artifacts/` и скачиваются без внешнего
прокси как в Document Preparation, так и при staging в runner. TenderPlan URLs
продолжают идти через существующие live proxy-параметры. Portable repository
exports не содержат proxy credentials.

## Ошибки

Workflow fail-closed останавливается до agentic Dispatch при:

- пустом названии или отсутствии файлов;
- превышении лимита;
- запрещённом расширении или executable magic;
- несовпадении upload/manifest identity;
- неполном preparation manifest;
- неполной atomic регистрации документов;
- неуспешном результате agentic Dispatch.

Production failures передаются в отдельный workflow
`TENDER — Ошибка ручной загрузки` (`xW4DHtnBYddbaU14`). Он по сохранённому
`n8n_execution_id` может перевести в `failed` только один принадлежащий этому
execution manual run с незавершённым статусом; чужие, неоднозначные и terminal
runs остаются неизменными. Успешная форма показывает `analysis_run_id`; готовый
отчёт создаёт существующий terminal contour.

## Проверка

```powershell
node --test tests/manual-upload-workflow.test.mjs \
  tests/archive-extractor-source-upload.test.mjs \
  tests/archive-extractor-http.test.mjs \
  tests/document-preparation-workflow.test.mjs \
  tests/agentic-dispatch-workflow.test.mjs
```

Runtime-canary 2026-09-12 загрузил 12 файлов Blind Test 2. Execution `18796`
успешно зарегистрировал `12/12` документов и запустил agentic job
`ad4aea11-04b8-4d26-a9a1-5d694c5584d8` для run
`0ac0b487-71b7-4a35-8412-e587f608aeca`. Monitor execution `18857` принял
валидные 27/27 полей и создал HTML/PDF отчёт.
