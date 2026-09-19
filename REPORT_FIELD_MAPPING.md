# REPORT\_FIELD\_MAPPING.md

## Назначение документа

Связующий документ между бизнес-форматом отчета Дмитрия и внутренними
полями системы `tender\_fields\_v1`.

Цепочка:

FIELD\_CATALOG.md → REPORT\_FIELD\_MAPPING.md → REPORT\_GENERATION workflow
→ Telegram report

## Mapping полей

\---

№                 Поле Дмитрия           field\_key системы                Источник

\---

1                 Предмет закупки        procurement\_subject              field\_results /
Tender metadata

2                 НМЦ (с НДС)            nm\_price\_with\_vat                field\_results +
Tender metadata

3                 Площадка               platform                         Tender metadata

4                 Тип процедуры          procedure\_type                   Tender metadata /
field\_results

5                 Срок окончания приема  application\_deadline             metadata /
заявок                                                  field\_results

6                 Дата рассмотрения      application\_review\_date          field\_results
заявок

7                 Дата подведения итогов results\_date                     field\_results

8                 Заказчик               customer                         metadata /
field\_results

9                 Контактная информация  customer\_contacts                field\_results
Заказчика

10                Стоимость участия      participation\_cost               field\_results

11                БГ на участие          participation\_guarantee          field\_results

12                Критерии оценки        evaluation\_criteria              field\_results

13                Срок поставки          delivery\_term                    field\_results
(исполнения)

14                Условия оплаты         payment\_terms                    field\_results

15                Спецсчет/казна         special\_account\_or\_treasury      field\_results

16                Банковское             bank\_support                     field\_results
сопровождение

17                Госконтракт            government\_contract              field\_results

18                Переторжка             rebidding                        field\_results

19                Национальный режим     national\_regime                  field\_results

20                БГ аванс               advance\_contract\_guarantee       field\_results

21                БГ гарантийные         warranty\_obligations\_guarantee   field\_results
обязательства

22                Лицензии/сертификаты   licenses\_certificates            field\_results

23                Необходимые справки    required\_official\_certificates   field\_results

24                Опыт аналогичных       similar\_supply\_experience        field\_results
поставок

25                Допускается ли аналог  analog\_allowed                   field\_results

26                Что считается аналогом analog\_definition                field\_results

27                Состав заявки          application\_documents            field\_results

## Правила отображения

Отчет не меняет результаты анализа.

Используются статусы:

* resolved --- подтверждено;
* requires\_review --- требует проверки;
* not\_found --- не найдено.

AI используется только для комментариев по спорным местам.

AI не может: - менять статус; - добавлять факты; - заменять evidence.

## Подтверждённый клиентский формат 2026-09-07

Решения Дмитрия меняют presentation contract следующим образом:

* реквизиты отчёта дополнительно показывают номер извещения/закупки из tender
  metadata; это не новое поле и не часть `platform`;
* `nm_price_with_vat` показывает сумму НМЦ и сведения об НДС раздельно;
* `application_review_date` показывает конечную дату периода;
* `results_date` перечисляет все подтверждённые события выбора победителя;
* `customer_contacts` разделяет контакт по процедуре и технический контакт, если
  обе роли подтверждены;
* `evaluation_criteria` показывает краткий перечень;
* `payment_terms` показывает структурированные аванс/остаток и полный текст;
* `special_account_or_treasury` показывает `да/нет` и тип;
* `rebidding` показывает `да/нет` без условий;
* `national_regime` показывает один из вариантов `Запрет`, `Ограничение`,
  `Преимущество`, `Не применяется`, без нормативной базы в таблице;
* `advance_contract_guarantee` раздельно показывает обеспечение исполнения и
  обеспечение аванса внутри одного поля;
* `similar_supply_experience` маркирует обязательный и оценочный опыт;
* `analog_definition` показывает краткое резюме;
* `application_documents` показывает краткий список после полного semantic
  анализа, не теряя обязательные/условные clauses в evidence и audit.

Эти правила являются целевым контрактом. До изменения Report Adapter/Renderer и
semantic workflows текущий live HTML не считается автоматически соответствующим
решениям от 2026-09-07.

## Особые поля

### nm\_price\_with\_vat

Нельзя считать любую сумму НМЦК автоматически.

При отсутствии прямого подтверждения:

* показывать как требующее проверки;
* добавлять комментарий.

### Гарантии

Особое внимание:

* participation\_guarantee;
* advance\_contract\_guarantee;
* warranty\_obligations\_guarantee.

Нельзя смешивать: - гарантию; - обеспечение; - гарантийный срок.

### Да/нет поля

Для:

* special\_account\_or\_treasury;
* bank\_support;
* government\_contract;
* rebidding;
* analog\_allowed;

не показывать "нет" без прямого подтверждения.

## Архитектура workflow

Trigger → Load analysis\_run → Load tender metadata → Load field\_results
→ Apply mapping → Prepare report JSON → Generate AI comments → Render
Markdown → Send Telegram

## Оставшиеся уточнения

1. Presentation policy для редкого случая нескольких юридических лиц, с которыми
   заключаются отдельные договоры.
2. Исчерпывающий перечень `required_official_certificates`, если Дмитрий решит
   закрепить его отдельно.
3. Проверяемый внешний источник тарифов площадки для `participation_cost`.
