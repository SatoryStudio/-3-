# Настройка Filament ERP

## Первый запуск

1. Установите Node.js 22+.
2. Создайте `.env.local`:

```env
SESSION_SECRET=длинная-случайная-строка-не-короче-32-символов
DATA_DIR=./data
APP_URL=http://localhost:3000
```

3. Запустите:

```bash
npm install
npm run dev
```

4. Откройте `http://localhost:3000` и создайте первого администратора.

## Ключ шифрования

Если `APP_SECRET_KEY` не задан, приложение автоматически создаёт `data/.app-secret-key` из 32 случайных байт с правами `0600`.

Этот файл нужно хранить вместе с резервными копиями. При его потере сохранённые API-ключи и Google OAuth-токены расшифровать невозможно. Можно задать постоянный ключ через `APP_SECRET_KEY` до первого сохранения интеграций.

## Google Sheets

1. В Google Cloud Console создайте OAuth Client типа Web application.
2. Настройте `APP_URL` как внешний адрес текущей установки. Callback всегда формируется как `${APP_URL}/api/google/oauth/callback`.

Фактические `APP_URL`, callback URL, Client ID mask, scopes и environment отображаются в
`Настройки → Google Sheets → OAuth Debug`. Скопируйте Generated callback URL без изменений
в Google Cloud Console: `APIs & Services → Credentials → OAuth Client → Authorized redirect URIs`.

Для локального запуска:

```text
APP_URL=http://localhost:3000
http://localhost:3000/api/google/oauth/callback
```

Для публичного сервера:

```text
APP_URL=https://aidaassistant.ru
https://aidaassistant.ru/api/google/oauth/callback
```

3. В Authorized redirect URIs добавьте точный URL, показанный в «Настройки» → «Google Sheets», затем включите Google Sheets API.
4. В ERP сохраните Client ID, Client Secret и ссылки на таблицы товаров и филамента.
5. Нажмите «Подключить Google» и разрешите доступ к таблицам.

Таблица товаров должна содержать:

```text
marketplace, marketplace_sku, name, filament_material, filament_color,
weight_grams, print_time_minutes, packaging_cost, extra_cost
```

Таблица филамента должна содержать:

```text
spool_id, material, color, brand, spool_weight_grams, remaining_weight_grams,
reserved_weight_grams, price_per_spool, price_per_kg, purchase_date, status, erp_updated_at
```

ERP записывает `spool_id`, резерв, статус и `erp_updated_at` обратно. Остаток, изменённый пользователем, проводится как складская корректировка; он не может стать меньше действующего резерва.

## Яндекс Маркет

Откройте «Настройки» → «Яндекс Маркет» и заполните:

- API Key;
- Campaign ID;
- Business ID, если используется business orders API;
- OAuth Token только для совместимости.

Сохраните настройки, затем нажмите «Проверить подключение». Старые `YANDEX_*` переменные окружения импортируются один раз, только если сохранённых XLSX-настроек ещё нет.

## Ozon

Откройте «Настройки» → «Ozon», заполните Client ID и API Key, сохраните и проверьте подключение.

Старые `OZON_CLIENT_ID` и `OZON_API_KEY` используются только для одноразовой миграции.

## Worker

Worker работает внутри Next.js-процесса. Значения по умолчанию:

- товары Google Sheets: каждые 15 минут;
- филамент Google Sheets: каждые 15 минут;
- заказы: каждые 5 минут;
- статусы: каждые 60 минут;
- финансы: каждые 1440 минут.

Состояние и интервалы сохраняются в `settings.xlsx`. После перезапуска приложения включённый worker восстанавливается автоматически.
Синхронизации и управляющие действия записываются в `sync_logs.xlsx`.

## Принтеры

Откройте «Настройки» → «Принтеры». Для каждого устройства задаются название, тип, Host, Access Code, Serial Number и активность.

- Ручной принтер полностью поддерживается: его можно назначить заданию, начать печать и ввести фактический расход при завершении.
- Bambu Lab можно сохранить и подготовить к подключению. Access Code шифруется тем же `SecretService`; MQTT-обмен будет подключён отдельным адаптером без изменения очереди и учёта.

Один принтер не может одновременно выполнять два задания. Фактический вес сохраняется вместе с источником: ручной ввод, принтер или история.

## Tunnel

На вкладке «Туннель» поддерживаются режимы:

- `none`;
- `manual` с готовым публичным HTTPS URL.

Проверка обращается к `<public-url>/api/health`. HTTP URL не принимаются. Автоматическое управление ngrok и Cloudflare в этот этап не входит.

## Хранилище и backup

На вкладке «Хранилище» доступны:

- проверка всех XLSX и версий схем;
- проверка временной записи в transaction-каталоге;
- счётчики заказов, товаров, катушек, движений и принтеров;
- создание полного backup.

Резервные копии находятся в `data/backups/`. Для полного восстановления верните XLSX-файлы в `data/` и обязательно восстановите тот же `data/.app-secret-key`.
