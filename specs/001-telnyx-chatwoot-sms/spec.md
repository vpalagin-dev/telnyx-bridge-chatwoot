# Feature Specification: Первая интеграция JAMA с Telnyx и локальным Chatwoot

**Feature Branch**: `001-telnyx-chatwoot-sms`  
**Created**: 2026-09-22  
**Status**: Tasked
**Input**: Спроектировать первый рабочий вертикальный срез JAMA SMS между Telnyx и существующим локальным Chatwoot по адресу `http://localhost:3001`: проверить текущую конфигурацию, описать входящий путь, проверить Chatwoot-originated outbound только подписанными fixtures с fake Telnyx и разрешить ровно один live operator CLI outbound на `TEST_RECIPIENT_NUMBER`, без массовых кампаний и автоматических исходящих сообщений.

## 1. Цель и границы

Фича создаёт спецификацию для первого рабочего вертикального среза JAMA SMS с существующим локальным Chatwoot:

1. MVP target — существующий локальный Chatwoot по адресу `http://localhost:3001`; Chatwoot Cloud не входит в scope.
2. В существующем Chatwoot создаётся или настраивается отдельный JAMA SMS inbox только через штатные UI/API configuration operations, без изменений существующих Telegram и WhatsApp inboxes.
3. Реализуется новый самостоятельный JAMA Telnyx↔Chatwoot bridge в этом репозитории; второй Chatwoot stack не создаётся.
4. Проверяется входящий путь Telnyx → новый bridge → локальный Chatwoot → диалог агента.
5. Chatwoot-originated outbound проверяется только подписанными Chatwoot fixtures и fake Telnyx; live Chatwoot-originated SMS запрещён.
6. Разрешён ровно один live operator CLI outbound на защищённый `TEST_RECIPIENT_NUMBER`.
7. Реализуется только индивидуальная ручная отправка. Массовые кампании, scheduler и AI/automation outbound не входят.

Новый bridge должен иметь собственный код, конфигурацию, deployment и хранилище correlation/suppression records. `C:\work\germes` остаётся внешним и не изменяется, кроме обычной конфигурации JAMA SMS inbox через Chatwoot UI/API. Через public tunnel/ingress публикуется только новый bridge; локальный Chatwoot напрямую не публикуется.

## Clarifications

### Session 2026-09-22

- Q: Как bridge получает ручное исходящее действие агента из локального Chatwoot? → A: Использовать Chatwoot webhook/event для исходящего сообщения; точное событие и payload подтверждаются live-аудитом как hard gate до story implementation.
- Q: Как выбирать Chatwoot conversation для входящего SMS при наличии нескольких диалогов? → A: Переиспользовать один открытый conversation на канонический номер в JAMA SMS inbox; закрытый conversation переоткрывать при новом входящем SMS.
- Q: Какова область действия suppression для исходящих сообщений? → A: Suppressed номер блокируется для всех исходящих SMS через JAMA bridge до отдельного подтверждённого opt-in.
- Q: Как bridge аутентифицирует webhook от local Chatwoot? → A: Live audit сначала определяет, поддерживает ли существующий local Chatwoot HMAC и каков его точный contract; при подтверждённой поддержке bridge проверяет наблюдаемый local HMAC contract и защищает от повторов по event/message ID, а при отсутствии HMAC implementation блокируется до отдельного утверждённого fallback.
- Q: Должен ли bridge хранить полный текст SMS? → A: Не хранить текст SMS; сохранять IDs, статусы, timestamps, masked number и при необходимости необратимый hash.

### Session 2026-09-22 — blocked after-tasks review

- Q: Какой Chatwoot является MVP target? → A: Только существующий локальный Chatwoot `http://localhost:3001`; Chatwoot Cloud и второй Chatwoot stack исключены. `C:\work\germes` остаётся внешним, а публичный ingress предоставляется только bridge.
- Q: Как проверяется outbound? → A: Chatwoot-originated outbound проверяется signed fixtures + fake Telnyx без live SMS; разрешён ровно один live operator CLI outbound на `TEST_RECIPIENT_NUMBER`.
- Q: Какие IDs обязательны в smoke evidence? → A: Для CLI-originated smoke Chatwoot IDs неприменимы и MAY быть `null`; для inbound и Chatwoot-originated fixture tests Chatwoot IDs обязательны.
- Q: Что доказывает авторизацию агента в MVP? → A: После live-audit selection `signing_profile_id=chatwoot_hmac_sha256_v1` webhook, валидный по compiled verifier этого профиля и пришедший из configured local JAMA SMS inbox, является достаточным authorization evidence; worker дополнительно проверяет configured account/inbox, `message_type`, human `sender.type=user` и conversation binding. Отдельный Chatwoot permission lookup не требуется; `unsupported` блокирует implementation без новой explicit clarification.
- Q: Как проверяется отсутствие регрессий Telegram/WhatsApp? → A: Достаточно static no-touch evidence: нет файловых изменений в `C:\work\germes`, нет configuration changes существующих inboxes и проходит scope-regression scan. Runtime Telegram/WhatsApp tests исключены.
- Q: Где проходит граница HTTP ingress и business filtering? → A: Route выполняет только authentication, raw-body capture, schema-envelope validation и durable receipt/dedupe. Business filtering выполняет worker после durable receipt. Invalid authentication возвращает `401/403`, malformed JSON/schema — `400`, authentic irrelevant/unsupported event — durable audit/dedupe и `200 ignored`.
- Q: Как обрабатывать unsupported Telnyx events? → A: Валидно подписанные, но unsupported Telnyx events durably audited/deduplicated и получают `200 ignored`; только unauthenticated или malformed requests получают `4xx`.
- Q: Какие дополнительные review gaps закрываются? → A: Добавляется metadata-only bridge correlation export, расширяется static scope-regression exclusion list, а live audit становится hard gate до любой story implementation.

### Session 2026-09-24 — blocking ambiguity resolution

- Q: Какой signing contract должен использовать Chatwoot outbound webhook? → A: Live audit MUST определить, соответствует ли existing local Chatwoot заранее определённому `chatwoot_hmac_sha256_v1`; при соответствии выбирается этот profile ID, иначе `unsupported`. Runtime не получает свободное описание contract; bearer-only, IP allowlist и unsigned webhook не являются fallback.
- Q: В каком виде live-audit facts становятся runtime readiness gate? → A: Они MUST храниться в machine-readable JSON readiness artifact со schema version, `created_at`, `expires_at`, Chatwoot URL/version, closed `signing_profile_id`, Telnyx sender/profile fingerprints, ingress URL/certificate fingerprint, structured evidence status/references и readiness fingerprint. CLI/runtime MUST fail closed при отсутствии, истечении, failed/unresolved group, probe failure/staleness или fingerprint mismatch; Markdown — только supplementary evidence.
- Q: Как ограничивается текст единственного live operator CLI smoke? → A: Он MUST помещаться ровно в один SMS segment. CLI MUST отклонять estimated segment count больше 1; для MVP разрешён только GSM-7/ASCII-compatible текст максимум 160 GSM-7 septets, без emoji, UCS-2 и non-GSM characters. Guard MUST использовать estimated segment count с учётом GSM-7 encoding, а не raw character count.

### Session 2026-09-24 — after-tasks review addendum

- Q: Как readiness представляет Chatwoot signing contract? → A: Readiness MUST хранить закрытый versioned `signing_profile_id`, а не произвольные algorithm/canonicalization fields для runtime interpretation. Разрешены только `chatwoot_hmac_sha256_v1`, если профиль подтверждён live audit, и `unsupported`, который блокирует Chatwoot outbound. Verifier выбирается статически по `signing_profile_id`; bearer-only, IP allowlist и unsigned fallback запрещены без новой явной clarification.
- Q: Как безопасно провести live signing audit до полной readiness? → A: Разрешён отдельный audit-receiver mode только для контролируемого локального Chatwoot test webhook и захвата sanitized signing/header/body evidence. Этот mode MUST NOT вызывать Telnyx, создавать Chatwoot side effects, запускать business workers или принимать/обрабатывать production messages; его output используется только как readiness evidence.
- Q: Какова точная область exactly-one CLI live outbound? → A: Database guard scoped по feature ID, fingerprint Telnyx sender/profile и readiness fingerprint. База данных является technical enforcement boundary. После удаления database/guard record историческую гарантию нельзя доказать; новый live smoke требует explicit human approval и считается новым exceptional scope, а не automatic retry.
- Q: Что имеет приоритет на webhook route: authentication или readiness? → A: Authentication/signature verification MUST выполняться до раскрытия readiness. Invalid/missing authentication возвращает `401/403` даже при invalid readiness; только authenticated request MAY получить sanitized readiness `503`. Malformed JSON/envelope получает `400` только после применимых raw-receipt/authentication rules; если безопасно аутентифицировать нельзя, route fail closed без provider side effects.
- Q: Какие current-environment probes обязательны? → A: Детерминированно проверяются local Chatwoot URL и observed version, selected Chatwoot `signing_profile_id`, Telnyx sender-number fingerprint, Telnyx messaging-profile fingerprint и bridge public-ingress HTTPS URL/certificate fingerprint. Failure, timeout, stale cache или mismatch делает readiness not-ready; конкретные timeout и cache TTL фиксируются в plan/tasks.
- Q: Как структурируется readiness evidence? → A: Не flat list: обязательны `evidence.chatwoot`, `evidence.telnyx`, `evidence.ingress`, `evidence.signing`, `evidence.fingerprints`, `evidence.operator_scope`; каждая группа имеет `pass|fail|unresolved` и evidence references.
- Q: Кто финализирует Chatwoot outbound contract? → A: До реализации Chatwoot outbound отдельная contract-finalization task MUST записать selected `signing_profile_id` и проверить OpenAPI/fixtures против статического verifier profile. При `unsupported` outbound tasks остаются blocked.
- Q: Каков lifecycle CLI smoke payload? → A: CLI smoke text существует только в памяти процесса и MUST NOT сохраняться даже encrypted. Stored CLI smoke records содержат только metadata, IDs, masked numbers, status, timestamps, segment count и необратимые hashes только при явном обосновании. Payload purge относится к stored provider webhook payloads и audit captures, не к CLI text.
- Q: Является ли текущий `tasks.md` устаревшим? → A: После внесения этой clarification `plan.md` и `tasks.md` reconciled; plan MUST NOT объявлять текущий regenerated `tasks.md` obsolete, пока новая staleness не возникнет.

## 2. Аудит текущего состояния

Аудит для этой фичи ограничивается JAMA-документацией, Telnyx account/configuration и существующим локальным Chatwoot `http://localhost:3001`.

| Область | Подтверждённое состояние | Классификация |
|---|---|---|
| Telnyx | В JAMA `.env` присутствуют credential, Telnyx sender number и messaging profile ID; пользователь подтверждает получение входящих SMS | B — configuration/integration; live account/webhook verification обязательна |
| Локальный Chatwoot | Существующий deployment доступен на `http://localhost:3001`; до story implementation требуется зафиксировать account ID, JAMA SMS inbox ID, API/webhook contract и signing configuration | A/B — native platform plus configuration; live audit — hard gate |
| Chatwoot SMS/Telnyx | Готовый native Telnyx channel не предполагается | C — новый custom bridge является зафиксированным MVP design |
| Existing channels | Telegram и WhatsApp должны остаться неизменными; достаточно static no-touch evidence | Жёсткое ограничение совместимости |
| JAMA implementation | Новый bridge ещё не реализован; второй Chatwoot stack не создаётся | C — custom component |

Telnyx предоставляет SMS API, inbound webhooks и delivery/failure events, а существующий локальный Chatwoot предоставляет inbox/conversation/API слой. Live audit до любой story implementation подтверждает точный API/webhook contract, account/inbox identifiers, подпись и credentials; это deployment gate, а не выбор между local и Cloud.

### 2.1. Native/configuration/custom matrix

| Возможность | Класс | Решение |
|---|---|---|
| Telnyx inbound/outbound SMS API | A — native | Использовать как транспорт |
| Telnyx inbound/delivery/failure webhooks | A — native | Использовать provider events и IDs |
| Локальный Chatwoot contacts, inboxes, conversations, agent UI | A — native | Использовать существующий интерфейс на `http://localhost:3001` |
| Native Telnyx channel в локальном Chatwoot | C — custom | Не предполагать наличие; новый bridge — зафиксированный MVP design |
| Telnyx↔Chatwoot translation, contact/conversation mapping | C — custom | Ответственность нового JAMA bridge |
| Ingress authentication and durable deduplication | B/C — provider facility plus custom consumer | Route проверяет authentication/envelope и durably принимает событие; worker выполняет business filtering |
| Individual outbound send guard | C — custom | Защищать от duplicate submission и blind retry |
| Durable suppression/opt-out state | B/C — provider block plus custom state | Telnyx block — defense in depth; JAMA guard обязателен |
| Metadata-only correlation/suppression export | C — custom | Предоставить защищённый operator export без SMS body и без логирования строк |
| Mass campaigns, scheduler, batching | D — out of scope | Не создавать |
| AI-initiated outbound | D — prohibited | Не создавать |
| Public ingress | B/C — infrastructure/configuration | Публиковать только bridge endpoint; локальный Chatwoot напрямую не публиковать |

## 3. User Scenarios & Testing

### User Story 1 — Входящий SMS появляется в local Chatwoot (Priority: P1)

Клиент отправляет SMS на JAMA Telnyx-номер. Агент видит это сообщение в отдельном JAMA SMS inbox в local Chatwoot, в правильном conversation и с корректным контактом.

**Почему этот приоритет**: Это доказывает, что существующий Telnyx inbound path становится рабочим операторским потоком.

**Independent Test**: Отправить одно SMS с тестового телефона и сопоставить Telnyx event ID, bridge processing record, local Chatwoot conversation ID и local Chatwoot message ID.

**Acceptance Scenarios**:

1. **Given** Telnyx sender number, messaging profile, webhook endpoint и JAMA SMS inbox в local Chatwoot настроены, **When** тестовый телефон отправляет SMS на JAMA-номер, **Then** новый bridge принимает валидный event, создаёт/находит контакт по нормализованному номеру и создаёт сообщение в правильном local Chatwoot conversation.
2. **Given** Telnyx повторяет тот же event, **When** bridge получает тот же provider event ID, **Then** он не создаёт duplicate local Chatwoot message и сохраняет duplicate/replay outcome.
3. **Given** подпись webhook отсутствует или невалидна, **When** bridge получает событие, **Then** он отклоняет его до local Chatwoot и фиксирует безопасную диагностическую запись.
4. **Given** local Chatwoot временно недоступен, **When** bridge получает валидное inbound событие, **Then** обработка остаётся retryable и повтор не создаёт duplicate message.

---

### User Story 2 — Агент вручную отправляет одно SMS (Priority: P1)

Авторизованный агент открывает JAMA SMS conversation в local Chatwoot, вводит текст и отправляет его. Новый bridge передаёт ровно одно сообщение в Telnyx.

**Почему этот приоритет**: Это минимальный полезный outbound flow, не создающий массового или автоматического риска.

**Independent Test**: После contract finalization replay Chatwoot `message_created/outgoing` fixture, подписанный по compiled `chatwoot_hmac_sha256_v1` verifier для configured local JAMA SMS inbox, через production-like bridge с fake Telnyx; сопоставить обязательные Chatwoot message/conversation IDs, bridge send record, fake Telnyx message ID и статус. При `signing_profile_id=unsupported` тест и implementation blocked. Live Chatwoot-originated SMS не выполняется.

**Acceptance Scenarios**:

1. **Given** readiness выбрала `signing_profile_id=chatwoot_hmac_sha256_v1`, webhook валиден по compiled verifier этого профиля для configured local JAMA SMS inbox, совпадают configured account/inbox, `message_type=outgoing`, human `sender.type=user` и conversation binding, а номер валиден и не suppressed, **When** worker обрабатывает durable event, **Then** bridge выполняет ровно одну fake Telnyx submission и сохраняет полный correlation chain без отдельного Chatwoot permission lookup.
2. **Given** сетевой сбой оставляет результат Telnyx неизвестным, **When** bridge обрабатывает ошибку, **Then** он не делает blind retry, переводит отправку в `unknown/needs_review` и показывает оператору проверяемый результат.
3. **Given** номер находится в durable suppression, **When** агент пытается отправить SMS, **Then** bridge блокирует вызов до Telnyx и сообщает причину в local Chatwoot/операторском логе.
4. **Given** повторяется то же исходное local Chatwoot outbound action, **When** bridge видит ту же action identity, **Then** он возвращает ранее сохранённый результат и не создаёт вторую Telnyx submission.

---

### User Story 3 — Оператор выполняет ограниченный smoke-test (Priority: P1)

Оператор задаёт тестовый номер только во внешнем защищённом окружении и запускает ровно один live outbound через CLI после прохождения readiness gates. Результат можно проверить без публикации секретов и полного номера.

**Independent Test**: Установить `TEST_RECIPIENT_NUMBER` в защищённом окружении bridge, выполнить one-time CLI smoke, получить masked report с bridge/Telnyx IDs и проверить, что число Telnyx submissions равно одному. Поскольку send является CLI-originated, Chatwoot IDs неприменимы и MAY быть `null`.

**Acceptance Scenarios**:

1. **Given** `TEST_RECIPIENT_NUMBER` задан и разрешён allowlist, **When** запускается send-test, **Then** bridge проверяет единственный target до вызова Telnyx.
2. **Given** номер отсутствует, невалиден или не разрешён, **When** запускается send-test, **Then** bridge завершается до Telnyx и создаёт 0 submissions.
3. **Given** CLI smoke-test завершён, **When** оператор читает отчёт, **Then** он видит masked recipient, bridge/Telnyx IDs, timestamps и outcome, а Chatwoot IDs обозначены как not applicable/`null`; отчёт не содержит API keys, webhook secrets или полный номер.
4. **Given** inbound или Chatwoot-originated fixture verification завершена, **When** формируется evidence, **Then** соответствующие Chatwoot conversation/message IDs обязательны.
5. **Given** live smoke text содержит non-GSM character, emoji, требует UCS-2 или имеет estimated GSM-7 length более 160 septets/estimated segment count более 1, **When** запускается send-test, **Then** CLI отклоняет сообщение до Telnyx и создаёт 0 submissions.

## 4. Edge Cases

- Повторная доставка одного Telnyx event ID после timeout.
- Два delivery attempts одного provider event.
- Валидно подписанный unsupported Telnyx event или authentic irrelevant Chatwoot event должен быть durably deduplicated и получить `200 ignored`, а не `4xx`.
- Невалидная authentication/signature получает `401/403`; malformed JSON/schema envelope получает `400` без business processing.
- Номер в разных форматах; suppression и matching используют канонический международный формат.
- local Chatwoot conversation существует, контакт отсутствует или найден неоднозначно.
- local Chatwoot/Telnyx временно недоступны.
- Telnyx принял сообщение, но ответ потерян; повтор не выполняется автоматически.
- Telnyx отклонил сообщение из-за opt-out, carrier block, messaging profile, compliance или rate limit.
- Агент отправляет из Telegram/WhatsApp inbox вместо JAMA SMS inbox.
- Bridge перезапущен между приёмом webhook и записью в local Chatwoot.
- Логи раскрывают полный номер, текст или секрет.
- Telnyx не может достичь bridge endpoint из-за отсутствующего или неверно настроенного HTTPS ingress.
- CLI smoke text выглядит короче 160 characters, но GSM-7 extension-table symbols требуют два septets и увеличивают estimated segment count; решение MUST основываться на encoding-aware estimate, а не raw character count.
- local Chatwoot изменил API/webhook behavior или permissions после обновления плана/аккаунта.

## 5. Functional Requirements

- **FR-001**: Система MUST использовать существующий локальный Chatwoot по адресу `http://localhost:3001`; Chatwoot Cloud MUST NOT использоваться в этой фиче.
- **FR-002**: Система MUST создать или настроить отдельный JAMA SMS inbox штатными Chatwoot UI/API operations, не изменяя существующие Telegram и WhatsApp inboxes.
- **FR-003**: Новый JAMA bridge MUST быть отдельным component в этом репозитории с собственными кодом, конфигурацией, deployment и хранилищем correlation/suppression records; второй Chatwoot stack MUST NOT создаваться.
- **FR-004**: `C:\work\germes` MUST оставаться внешним и MUST NOT изменяться этой фичей, кроме обычной Chatwoot UI/API configuration JAMA SMS inbox.
- **FR-005**: Через public tunnel/ingress MUST публиковаться только новый bridge; локальный Chatwoot MUST NOT публиковаться напрямую.
- **FR-006**: HTTP webhook routes MUST выполнять только authentication, exact raw-body capture, JSON/schema-envelope validation и durable receipt/dedupe; business filtering MUST выполняться worker после durable receipt. Authentication/signature verification MUST предшествовать readiness disclosure.
- **FR-007**: Invalid/missing authentication MUST возвращать `401/403` даже при invalid readiness. Только authenticated request MAY получить sanitized readiness-related `503`. Malformed JSON/schema envelope MUST возвращать `400` только после route-specific raw-body/authentication rules; если request нельзя безопасно аутентифицировать, route MUST fail closed без provider side effects.
- **FR-008**: Валидно аутентифицированные, но irrelevant/unsupported события MUST быть durably audited/deduplicated и ACKed как `200 ignored` без provider/Chatwoot side effects.
- **FR-009**: Валидно подписанные unsupported Telnyx events MUST следовать `200 ignored`; только unauthenticated или malformed Telnyx requests MAY получать `4xx`.
- **FR-010**: Bridge MUST преобразовывать eligible inbound SMS в local Chatwoot contact/conversation/message, сохраняя provider IDs и нормализованный номер.
- **FR-011**: Bridge MUST связывать Telnyx event ID, Telnyx message ID, bridge processing record, Chatwoot conversation ID и Chatwoot message ID.
- **FR-012**: Bridge MUST дедуплицировать inbound events по стабильному Telnyx event ID и MUST NOT создавать duplicate Chatwoot message.
- **FR-013**: Bridge MUST классифицировать retryable, permanent и unknown outcomes; unknown outcome нельзя повторять вслепую.
- **FR-014**: При `signing_profile_id=chatwoot_hmac_sha256_v1` валидный Chatwoot webhook, проверенный статически выбранным verifier этого профиля и пришедший из configured local JAMA SMS inbox, MUST считаться достаточным authorization evidence для MVP; отдельный Chatwoot permission lookup MUST NOT требоваться. При `signing_profile_id=unsupported` Chatwoot-originated outbound implementation MUST оставаться blocked.
- **FR-015**: Worker MUST дополнительно отклонять outbound events с несовпадающими configured account/inbox, не-`outgoing` message type, не-user sender, automation/private/template markers или отсутствующей/несовпадающей conversation binding.
- **FR-016**: Один исходный Chatwoot outbound action MUST приводить не более чем к одной Telnyx submission; live Chatwoot-originated SMS MUST NOT выполняться в этой фиче.
- **FR-017**: Chatwoot-originated outbound MUST проверяться signed fixtures + fake Telnyx, при этом Chatwoot conversation/message IDs обязательны в evidence. До его implementation contract-finalization MUST записать selected `signing_profile_id` и валидировать OpenAPI/fixtures против статически выбранного verifier profile; `unsupported` блокирует outbound tasks.
- **FR-018**: После прохождения всех readiness/verification gates оператор MUST выполнить ровно один live operator CLI outbound на внешний allowlisted `TEST_RECIPIENT_NUMBER`; database guard MUST ограничивать attempt tuple из feature ID, Telnyx sender/profile fingerprint и readiness fingerprint, live smoke text MUST проходить single-segment guard, а Chatwoot IDs в CLI-originated report MUST быть `null`/not applicable. Если database/guard record удалён, повторный live smoke MUST требовать explicit human approval как новый exceptional scope и MUST NOT считаться automatic retry.
- **FR-019**: Outbound SMS MUST отправляться только через заданный JAMA Telnyx sender/messaging profile.
- **FR-020**: Bridge MUST хранить outbound correlation record и доступные delivery/failure status updates.
- **FR-021**: Bridge MUST проверять durable suppression до любого outbound SMS и MUST блокировать suppressed номер для всех исходящих SMS до отдельного подтверждённого opt-in.
- **FR-022**: Система MUST обрабатывать STOP, UNSUBSCRIBE, CANCEL, END и QUIT как opt-out commands на inbound path или явно фиксировать эквивалентную native Telnyx обработку с durable suppression state.
- **FR-023**: Suppression MUST переживать webhook retry, bridge restart, contact merge и повторный импорт.
- **FR-024**: Bridge MUST вести metadata-only audit log для receipt, signature check, dedupe, filtering outcome, suppression, send, provider response и status update.
- **FR-025**: Логи MUST маскировать полный номер, API keys, webhook secrets и иные credentials; bridge MUST NOT хранить полный текст SMS в correlation, suppression или audit records. CLI smoke text MUST оставаться memory-only и MUST NOT сохраняться даже encrypted; CLI records MAY содержать только metadata, IDs, masked numbers, status, timestamps, segment count и явно обоснованные irreversible hashes.
- **FR-026**: Bridge MUST предоставлять защищённые metadata-only exports как для suppression records, так и для bridge correlation records независимо от удаления Chatwoot contact.
- **FR-027**: Telegram/WhatsApp regression evidence MUST быть статическим: отсутствие file changes в `C:\work\germes`, отсутствие configuration changes существующих inboxes и успешный scope-regression scan. Runtime Telegram/WhatsApp tests MUST NOT требоваться.
- **FR-028**: До начала любой user-story implementation live audit MUST зафиксировать local Chatwoot account/inbox IDs, API/webhook contract и selected closed `signing_profile_id`, а также Telnyx sender/profile, signature, event/retry и send restrictions.
- **FR-029**: Для каждого канонического номера MUST использоваться один открытый conversation в JAMA SMS inbox; закрытый conversation MUST переоткрываться при новом inbound SMS.
- **FR-030**: Live audit MUST выбрать ровно один closed versioned `signing_profile_id`: `chatwoot_hmac_sha256_v1` только при live подтверждении поддерживаемого contract либо `unsupported`. Runtime MUST выбирать заранее реализованный verifier по ID и MUST NOT строить verifier из arbitrary algorithm/canonicalization text. `unsupported` блокирует Chatwoot outbound; bearer-only, IP allowlist и unsigned webhook MUST NOT использоваться без новой explicit clarification.
- **FR-031**: Эта фича MUST NOT включать campaigns, audience selection, scheduler, batching, broadcast/public send endpoint, pause/resume, throughput optimization или cost estimation.
- **FR-032**: Эта фича MUST NOT включать AI/automation outbound, link tracking, analytics, attribution или CRM functionality.
- **FR-033**: Эта фича MUST NOT автоматизировать A2P/10DLC registration или number purchase/provisioning.
- **FR-034**: Correlation/audit metadata MAY включать provider/Chatwoot IDs, статусы, timestamps, masked number и необратимый hash только при документированной диагностической необходимости.
- **FR-035**: Live-audit facts MUST сохраняться в machine-readable JSON readiness artifact, содержащем как минимум schema version, `created_at`, `expires_at`, Chatwoot URL/version, closed `signing_profile_id`, Telnyx sender-number fingerprint, Telnyx messaging-profile fingerprint, bridge public-ingress HTTPS URL/certificate fingerprint, overall status и structured evidence. Markdown evidence MAY дополнять artifact, но MUST NOT быть authoritative readiness input.
- **FR-036**: CLI и runtime readiness checks MUST парсить JSON readiness artifact и MUST fail closed с требованием re-audit, если artifact отсутствует, не проходит schema validation, истёк, имеет failed/unresolved status либо required probe fails, times out, uses stale cache or finds a mismatch. Required deterministic probes cover local Chatwoot URL/observed version, selected `signing_profile_id`, Telnyx sender-number fingerprint, Telnyx messaging-profile fingerprint и bridge public-ingress HTTPS URL/certificate fingerprint.
- **FR-037**: Live operator CLI smoke MUST принимать только GSM-7/ASCII-compatible text, запрещать emoji, UCS-2 и любые non-GSM characters, вычислять estimated segment count с учётом GSM-7 extension-table characters и MUST отклонять до Telnyx любой текст длиннее 160 GSM-7 septets или с estimated segment count не равным 1. Raw character count alone MUST NOT использоваться как safety guard.
- **FR-038**: Readiness artifact MUST содержать structured groups `evidence.chatwoot`, `evidence.telnyx`, `evidence.ingress`, `evidence.signing`, `evidence.fingerprints` и `evidence.operator_scope`; каждая required group MUST иметь `pass`, `fail` или `unresolved` status и evidence references. Любой не-`pass` required group блокирует readiness.
- **FR-039**: До полной readiness MAY использоваться dedicated audit-receiver mode только для controlled local Chatwoot test webhook. Он MUST захватывать только sanitized signing/header/body evidence, MUST NOT вызывать Telnyx, создавать Chatwoot side effects, запускать business workers или принимать/обрабатывать production messages, а stored audit capture MUST подлежать purge policy.
- **FR-040**: Payload purge requirements MUST применяться к stored provider webhook raw payloads и audit captures; CLI smoke text не является stored payload и MUST уничтожаться с process memory без durable copy.
- **FR-041**: Database guard является technical enforcement boundary exactly-one CLI attempt. Guard identity MUST включать feature ID, Telnyx sender/profile fingerprint и readiness fingerprint; утрата database/guard record лишает систему доказуемости historical guarantee.
- **FR-042**: До Chatwoot outbound implementation contract-finalization MUST record selected `signing_profile_id` и validate OpenAPI/fixtures against that profile. `signing_profile_id=unsupported` MUST оставлять Chatwoot outbound tasks blocked.

### Constitutional requirements

- **Principle II — suppression**: durable opt-out record и pre-send guard обязательны; Telnyx carrier block является дополнительной защитой.
- **Principle III — human initiation**: outbound начинается только ручным действием авторизованного агента в локальном Chatwoot или явным one-time operator CLI smoke action.
- **Principle IV — safe sending**: dedupe, one-submit guard, provider correlation и explicit unknown state обязательны.
- **Principle V — data ownership**: metadata-only bridge correlation records и suppression state должны быть защищённо экспортируемыми независимо от удаления Chatwoot contact.
- **Principle VI — evidence**: реализация должна использовать TDD и runtime smoke-test; эта спецификация не заявляет, что интеграция уже работает.

## 6. Key Entities

- **JAMA SMS Inbox**: отдельный local Chatwoot inbox для нового Telnyx bridge.
- **Contact**: SMS identity, канонический международный номер и local Chatwoot contact mapping.
- **Conversation**: local Chatwoot диалог JAMA с одним SMS-контактом.
- **Inbound Telnyx Event**: provider event с event ID, message ID, sender, recipient, text и timestamps.
- **Outbound Send Record**: ручное действие агента, target, suppression decision, Telnyx submission/message ID, state и timestamps.
- **Suppression Record**: durable opt-out по каноническому номеру с source/time/evidence.
- **Correlation Chain**: связи Telnyx, bridge и local Chatwoot identifiers.
- **Smoke-test Run**: запуск с `TEST_RECIPIENT_NUMBER` и masked evidence report.
- **Readiness Artifact**: versioned machine-readable JSON snapshot live-audit facts с validity window, environment fingerprints, pass/fail status и evidence references; единственный authoritative input для CLI/runtime readiness decisions.

## 7. Success Criteria

- **SC-001**: Один inbound test SMS появляется в правильном JAMA SMS conversation в течение 60 секунд при доступности зависимостей.
- **SC-002**: Повторная доставка одного Telnyx event ID создаёт 0 дополнительных local Chatwoot messages.
- **SC-003**: Один Chatwoot fixture action создаёт не более 1 fake Telnyx submission; live Chatwoot-originated submissions равны 0.
- **SC-004**: Inbound и Chatwoot fixture evidence содержат обязательные Chatwoot IDs; one-time CLI report содержит bridge/Telnyx IDs, timestamps и outcome, а Chatwoot IDs равны `null`/not applicable.
- **SC-005**: Suppressed number блокируется до Telnyx в 100% повторяемых проверок, включая после bridge restart.
- **SC-006**: Невалидный/отсутствующий/неразрешённый `TEST_RECIPIENT_NUMBER`, non-GSM/UCS-2/emoji text либо text с estimated segment count больше 1 приводит к 0 Telnyx submissions; после всех gates один валидный GSM-7/ASCII-compatible CLI smoke длиной не более 160 GSM-7 septets создаёт ровно 1 Telnyx submission attempt, и permanent scope запрещает вторую.
- **SC-007**: Static regression evidence подтверждает 0 file changes в `C:\work\germes`, 0 configuration changes существующих Telegram/WhatsApp inboxes и успешный scope-regression scan.
- **SC-008**: Для каждого обязательного шага документировано native/configuration/custom решение и обосновано, почему custom bridge необходим.
- **SC-009**: Live audit hard gate пройден до начала любой story implementation; unresolved gate item блокирует implementation tasks.
- **SC-010**: Фича создаёт 0 AI/automation outbound messages и не предоставляет массового send surface.
- **SC-011**: Authentic unsupported Telnyx и irrelevant Chatwoot events получают durable ignored record и `200`, тогда как authentication/schema failures получают соответствующий `4xx`.
- **SC-012**: Защищённые metadata-only suppression и correlation exports доступны без SMS body, secrets или logged export rows.
- **SC-013**: CLI/runtime readiness возвращает not-ready и не допускает live traffic для 100% проверок с отсутствующим, schema-invalid, expired, failed/unresolved или environment-mismatched JSON readiness artifact; Markdown-only evidence никогда не переводит систему в ready.

## 8. Risks and Unknowns

### Risks

1. Существующий локальный Chatwoot может иметь отличающийся API/webhook contract; live audit является hard gate до story implementation.
2. Telnyx нужен отдельный публичный HTTPS ingress к новому bridge; локальный Chatwoot нельзя публиковать напрямую.
3. Изменения локального Chatwoot API/signing configuration могут повлиять на воспроизводимость интеграции; exact contract фиксируется evidence.
4. Неоднозначный Telnyx результат нельзя решать blind retry из-за риска duplicate SMS.
5. Telnyx carrier-level opt-out не заменяет JAMA suppression state.
6. Telnyx API credential должен храниться только в защищённом secret storage; его нельзя коммитить, выводить или передавать в чат. При подозрении на утечку credential нужно ротировать.

### Unknowns before implementation

- Account ID и JAMA SMS inbox ID существующего Chatwoot `http://localhost:3001`.
- Поддерживает ли существующий local Chatwoot HMAC, и если да — точный observed HMAC contract: headers, signed bytes, timestamp/freshness, digest encoding, payload casing и secret configuration; также minimum-permission token behavior.
- Telnyx webhook URL/signing configuration, event types, retry behavior и delivery/failure semantics.
- Как local Chatwoot API создаёт/находит contact и conversation для external phone number.
- Требуется ли отдельный Telnyx messaging profile для JAMA SMS.
- Точный тестовый номер; он намеренно остаётся во внешнем secret environment как `TEST_RECIPIENT_NUMBER`.

## 9. Readiness Gate

К реализации можно переходить только после прохождения live-audit hard gate. Setup может подготовить только bridge scaffold/test harness, но никакая user-story implementation не начинается, пока:

1. Live audit не зафиксировал `http://localhost:3001`, observed version, account ID, JAMA SMS inbox ID, API/webhook contract, minimum-permission credentials и closed `signing_profile_id`. Только `chatwoot_hmac_sha256_v1` разрешает Chatwoot outbound; `unsupported` оставляет его blocked без fallback.
2. Live audit не подтвердил Telnyx sender/profile, public key/signature verification, event IDs/types, retry/status semantics и send restrictions.
3. Не определены безопасный public ingress только для bridge, mapping, dedupe, retry и unknown-outcome contracts.
4. `TEST_RECIPIENT_NUMBER` не защищён allowlist guard или находится в source control.
5. Не подтверждено, что `C:\work\germes` и существующие Telegram/WhatsApp inbox configurations остаются неизменными.
6. Любая required evidence group `chatwoot`, `telnyx`, `ingress`, `signing`, `fingerprints` или `operator_scope` имеет статус fail/unresolved; в этом случае story implementation MUST оставаться blocked.
7. Не создан и не провалидирован authoritative machine-readable JSON readiness artifact с schema version, timestamps, closed `signing_profile_id`, required deterministic fingerprints/probes и structured evidence groups/status/references.
8. JSON readiness artifact отсутствует, истёк, имеет failed/unresolved status, probe failure/timeout/stale cache либо mismatch current Chatwoot/Telnyx/ingress facts; CLI/runtime MUST fail closed и требовать re-audit. На webhook routes authentication MUST выполняться раньше readiness disclosure: invalid/missing auth получает `401/403`, и только authenticated request MAY получить sanitized `503`. Markdown evidence является только supplementary.
9. До Chatwoot outbound implementation не завершена contract-finalization, записывающая selected `signing_profile_id` и валидирующая OpenAPI/fixtures против статического profile verifier.

## 10. Out of Scope

- Chatwoot Cloud, любые дополнительные Chatwoot accounts/instances и альтернативные SMS-провайдеры.
- Изменения файлов под `C:\work\germes` или configuration существующих Telegram/WhatsApp inboxes; runtime Telegram/WhatsApp tests.
- Публичный ingress к локальному Chatwoot.
- Live Chatwoot-originated outbound SMS.
- Массовые кампании, аудитории, scheduler, batching, broadcast/public send endpoint, pause/resume, throughput optimization и cost estimation.
- AI-инициированные сообщения и automation outbound.
- Link tracking, analytics, attribution, revenue attribution и CRM.
- Публикация Chatwoot credentials, Telnyx credentials, webhook secrets или тестового номера.
- A2P/10DLC automation и number purchase/provisioning.

## 11. Assumptions and Dependencies

- Существующий локальный Chatwoot доступен по `http://localhost:3001`; JAMA SMS inbox конфигурируется штатными UI/API operations.
- `C:\work\germes` является внешней зависимостью и не изменяется этой фичей.
- Telnyx number и messaging profile уже существуют и могут быть настроены для нового bridge webhook path.
- `TEST_RECIPIENT_NUMBER` задаётся оператором вне репозитория.
- Новый bridge размещается в этом репозитории и имеет собственное хранилище metadata-only correlation/suppression records.
- Runtime delivery outcome может быть `accepted`, `delivered`, `failed` или `unknown`; готовность должна различать эти состояния.
- Новый bridge зависит только от configured local Chatwoot account/inbox и Telnyx account.

## 12. Specification Note

Эта спецификация фиксирует clarification decisions для проверяемого первого среза. Интеграция не считается реализованной или проверенной до прохождения live-audit hard gate, TDD, одного live inbound acceptance check, Chatwoot-originated fixture verification с fake Telnyx, ровно одного live operator CLI outbound и evidence-based verification gate.
