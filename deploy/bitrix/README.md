# Bitrix24 one-way delivery deployment

Этот runbook применяется только после получения Bitrix24 access. Repository содержит неактивные кандидаты и sentinels; production n8n и PostgreSQL заранее не изменяются.

## Перед началом

Нужны отдельные разрешения на:

- создание inbound webhook и регистрацию бота в Bitrix24;
- импорт/настройку/publish n8n workflows;
- применение SQL migration `database/migrations/20260920_create_tender_analysis_deliveries.sql`.

Реальные webhook URL и `botToken` нельзя отправлять в чат, коммитить, помещать в fixture, screenshot или лог.

## Порядок настройки

1. Создать Bitrix24 inbound webhook с scope `imbot`.
2. Сгенерировать случайный `botToken` длиной не более 40 символов и хранить его вне Git и чатов.
3. Вызвать `imbot.v2.Bot.register` со стабильным `fields.code` и созданным `fields.botToken`.
4. Сохранить возвращённый `botId`.
5. Добавить зарегистрированного бота в существующий целевой групповой чат.
6. Сохранить `dialogId` в форме `chat{numeric_chat_id}`.
7. Импортировать три неактивных workflow в порядке: error, delivery, retry.
8. Заменить `__BITRIX_ERROR_WORKFLOW_ID__` и `__BITRIX_DELIVERY_WORKFLOW_ID__` на ID импортированных workflow.
9. Ввести полный URL метода `imbot.v2.File.upload` прямо в ноду `Отправить PDF в Bitrix` вместо `__BITRIX_WEBHOOK_FILE_UPLOAD_URL__`.
10. Ввести `botId`, `dialogId` и `botToken` прямо в `Конфигурация Bitrix` вместо соответствующих sentinels.
11. Назначить импортированный error workflow в `settings.errorWorkflow` у delivery и retry workflow.
12. Применить проверенную SQL migration только после отдельного разрешения на запись в БД.
13. Оставить все workflow неактивными на время pinned/mock validation.
14. Опубликовать error workflow, затем delivery workflow и запустить один контролируемый manual canary.
15. Проверить видимое сообщение, читаемый PDF, `messageId`, `file.id`, размер файла и ровно одну journal-строку `sent`.
16. Опубликовать retry worker.
17. Только после успешного canary заменить production Finalization post-report connection на вызов delivery.
18. Любой последующий live export сначала санитизировать и только затем добавлять в repository.
19. Для rollback отключить Finalization → Delivery и снять с публикации retry worker; journal rows и уже доставленные сообщения не удалять.

## Canary: ожидаемое сообщение

```text
Отчёт по закупке №{tender_number}
Предмет: {subject}
Заказчик: {customer}
Начальная цена: {initial_price}

Результаты: подтверждено — {resolved}; требуют проверки — {requires_review}; не найдено — {not_found}.
```

Отдельной последней строки-предупреждения нет.

До publish убедиться, что `resolved + requires_review + not_found = 27`, PDF начинается с `%PDF-`, MIME равен `application/pdf`, имя заканчивается на `.pdf`, а размер в journal совпадает с ответом Bitrix.

## Санитизация live export

```bash
node scripts/sanitize-bitrix-workflow-export.mjs \
  /path/to/live-delivery-export.json \
  workflows/n8n-exports/beta/'[BITRIX] TENDER — Отправить отчёт в Bitrix.json'

node --test tests/bitrix-secret-safety.test.mjs
```

Скрипт должен вернуть неактивный export с пустым `pinData`, без top-level identity metadata и только с четырьмя configuration sentinels.

## Rollback и неоднозначный исход

- Не удалять `sent`, `failed` или `unknown` rows.
- Не повторять `unknown` автоматически: сообщение могло быть принято Bitrix до transport failure.
- Ручная повторная отправка возможна только как отдельное явное решение владельца после проверки Bitrix и journal; текущая автоматизация такого операторского workflow не содержит.
- Report Generation продолжает работать независимо от Bitrix.
