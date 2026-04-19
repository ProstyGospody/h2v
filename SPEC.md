# VPN Panel — Production Specification

> Самописная панель управления для одного VDS, объединяющая VLESS (XTLS-Reality) и Hysteria 2 под единым интерфейсом.
> Документ — полный технический контракт для разработки. Читается сверху вниз, каждая секция самодостаточна.

---

## Оглавление

1. [Цели и принципы](#1-цели-и-принципы)
2. [Общая архитектура](#2-общая-архитектура)
3. [Технологический стек](#3-технологический-стек)
4. [Файловая раскладка VDS](#4-файловая-раскладка-vds)
5. [Модель данных](#5-модель-данных)
6. [Бэкенд: структура и слои](#6-бэкенд-структура-и-слои)
7. [Интеграция с ядрами](#7-интеграция-с-ядрами)
8. [Фоновые задачи](#8-фоновые-задачи)
9. [HTTP API](#9-http-api)
10. [Subscription и формат URI](#10-subscription-и-формат-uri)
11. [Шаблоны конфигов ядер](#11-шаблоны-конфигов-ядер)
12. [Фронтенд: структура и UX](#12-фронтенд-структура-и-ux)
13. [install.sh](#13-installsh)
14. [.env спецификация](#14-env-спецификация)
15. [Systemd юниты](#15-systemd-юниты)
16. [Безопасность](#16-безопасность)
17. [Стабильность и надёжность](#17-стабильность-и-надёжность)
18. [Мониторинг и observability](#18-мониторинг-и-observability)
19. [Backup и восстановление](#19-backup-и-восстановление)
20. [Roadmap разработки](#20-roadmap-разработки)
21. [Типичные грабли](#21-типичные-грабли)

---

## 1. Цели и принципы

### Что строим

Панель управления VPN-сервером на одном VDS. Обслуживает два прокси-протокола одновременно:

- **VLESS + XTLS-Reality** на TCP/443 — маскировка под чужой TLS-сайт.
- **Hysteria 2** на UDP/8443 — QUIC-транспорт с Let's Encrypt TLS и опциональной Salamander-обфускацией.

Панель не обрабатывает клиентский трафик — этим занимаются ядра Xray-core и Hysteria 2. Панель управляет пользователями, собирает статистику, генерирует подписки и отдаёт дашборд.

### Принципы

1. **БД — единственный источник истины.** Любое изменение состояния идёт сначала в Postgres, потом в ядра. Расхождения чинятся reconciler'ом.
2. **Изоляция процессов.** Три независимых systemd-юнита (xray, hysteria, panel). Падение одного не трогает остальных.
3. **Hot-add пользователей.** Добавление/удаление клиентов без рестарта ядер. Xray через gRPC, Hysteria через auth-webhook.
4. **Всё автоматически, где возможно.** Секреты, ключи, токены генерируются скриптом. Пользователя спрашиваем только о том, что нельзя угадать.
5. **Идемпотентность.** install.sh, reconciler, миграции БД — всё можно запускать повторно без вреда.
6. **Продуктовый UX.** Админ видит дашборд как в Linear/Vercel. Конечный пользователь видит QR + кнопки без технических терминов.
7. **Отказоустойчивость первого порядка.** Кэш переживает рестарт БД, auth-webhook работает при любых проблемах, webhook latency P99 < 10ms.

### Что НЕ делаем в этой версии

- Multi-node (ноды на разных серверах). Всё на одном VDS.
- Биллинг/платежи. Только управление пользователями и лимитами.
- Реселлинг (субадмины с ограниченными правами). Один уровень — admin.
- Протоколы кроме VLESS и Hysteria 2.
- Клиентские приложения. Только веб-подписка.

---

## 2. Общая архитектура

### Три процесса на одном VDS

```
┌──────────────────────────────────────────────────────────────┐
│                         VDS (Ubuntu 24.04)                    │
│                                                               │
│  ┌────────────────┐   gRPC :10085   ┌──────────────────────┐ │
│  │ xray.service   │◄─────────────────┤                      │ │
│  │ TCP/443        │                  │  panel.service       │ │
│  │ VLESS+Reality  │                  │  HTTP :8000          │ │
│  └────────────────┘                  │  (REST API + Sub +   │ │
│                                      │   hy2 auth webhook)  │ │
│  ┌────────────────┐  HTTP :7653      │                      │ │
│  │ hysteria.svc   │◄─────────────────┤                      │ │
│  │ UDP/8443       │  (traffic poll)  │                      │ │
│  │                │                  │                      │ │
│  │                │──── POST /hy2/auth ──► 127.0.0.1:8000  │ │
│  │                │  (webhook при подключении клиента)     │ │
│  └────────────────┘                  └──────┬───────────────┘ │
│                                             │                  │
│                                      ┌──────▼──────────┐       │
│                                      │  PostgreSQL     │       │
│                                      │  127.0.0.1:5432 │       │
│                                      └─────────────────┘       │
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  Caddy — reverse proxy для панели (443 на panel-домене) │  │
│  │  Автоматический Let's Encrypt для домена панели         │  │
│  └─────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### Потоки коммуникации

| Источник | Приёмник | Транспорт | Назначение |
|----------|----------|-----------|------------|
| panel | xray | gRPC `127.0.0.1:10085` | AddUser / RemoveUser / QueryStats |
| panel | hysteria | HTTP `127.0.0.1:7653` | GetTraffic / Kick |
| hysteria | panel | HTTP `127.0.0.1:8000/hy2/auth` | Валидация токена при подключении клиента |
| client | caddy → panel | HTTPS `panel-домен:443` | Админ-API, страница подписки |
| VPN-клиент | xray | TCP `:443` | VLESS трафик |
| VPN-клиент | hysteria | UDP `:8443` | Hysteria 2 трафик |

### Критические инварианты

- Auth-webhook Hysteria слушает **только** `127.0.0.1` — физически недоступен из сети.
- Traffic API Hysteria и gRPC Xray слушают **только** `127.0.0.1`.
- Reality-трафик НЕ проходит через Caddy — Xray сам слушает 443/tcp.
- Панель **никогда** не рестартует ядра при CRUD пользователей. Только при изменении структурных настроек (порт, сертификат, bandwidth).

---

## 3. Технологический стек

### Бэкенд

- **Язык:** Go 1.22+
- **HTTP фреймворк:** Fiber v3 (или chi, если требуется net/http совместимость)
- **БД:** PostgreSQL 16+
- **Драйвер:** `pgx/v5` + пул `pgxpool`
- **Миграции:** `pressly/goose` (SQL файлы в `migrations/`)
- **gRPC клиент:** `google.golang.org/grpc` с proto-файлами из Xray-core
- **Валидация:** `go-playground/validator/v10`
- **Логирование:** `log/slog` (stdlib), JSON формат
- **Конфиг:** `caarlos0/env/v11` для парсинга .env
- **Пароли:** `golang.org/x/crypto/argon2` (argon2id)
- **JWT:** `golang-jwt/jwt/v5`
- **TOTP:** `pquerna/otp`
- **Метрики:** `prometheus/client_golang`
- **Cache:** встроенный `sync.Map` для MVP, `dgraph-io/ristretto` если нужна LRU
- **UUID:** `google/uuid`
- **Retry:** `avast/retry-go/v4`

### Фронтенд

- **Build:** Vite 5
- **UI:** React 19 + TypeScript 5
- **Стили:** TailwindCSS 4
- **Компоненты:** shadcn/ui (Radix-based, копируется в проект)
- **Данные:** `@tanstack/react-query` v5
- **Роутинг:** `@tanstack/react-router`
- **Формы:** `react-hook-form` + `zod`
- **Редактор:** `@monaco-editor/react`
- **Графики:** `recharts`
- **Иконки:** `lucide-react`
- **Тосты:** `sonner`
- **Даты:** `date-fns`
- **QR:** `qrcode.react` (fallback, основное — с бэка)

### Инфраструктура

- **ОС:** Ubuntu 22.04 LTS или 24.04 LTS (оба поддерживаются)
- **Reverse proxy:** Caddy 2 (автоматический ACME)
- **TLS для Hysteria:** Let's Encrypt через certbot standalone
- **Supervisor:** systemd
- **Сборка:** Makefile + `goreleaser` для релизов
- **Контейнеризация:** НЕ используем. Всё нативно через systemd.

### Ядра (внешние бинарники)

- **Xray-core:** последний stable с `https://github.com/XTLS/Xray-core/releases`
- **Hysteria 2:** последний stable с `https://github.com/apernet/hysteria/releases`

Ставятся официальными install-скриптами, затем их systemd-юниты и конфиги перезаписываются нашими.

---

## 4. Файловая раскладка VDS

```
/opt/mypanel/
├── .env                              # все переменные и секреты
├── bin/
│   └── panel                         # собранный Go-бинарник бэкенда
├── frontend/                         # статика React (dist/)
│   ├── index.html
│   └── assets/
├── configs/
│   ├── xray/
│   │   ├── config.json               # активный (рендерится из шаблона)
│   │   └── config.json.bak           # предыдущая версия
│   └── hysteria/
│       ├── config.yaml
│       └── config.yaml.bak
├── templates/
│   ├── xray.config.json.tmpl
│   └── hysteria.config.yaml.tmpl
├── data/
│   ├── backups/
│   │   └── panel-YYYY-MM-DD.sql.gz   # ежедневные дампы
│   └── runtime/                      # временные файлы
└── logs/                             # ротируемые логи (через logrotate)

/usr/local/bin/
├── xray                              # официальный бинарник Xray-core
└── hysteria                          # официальный бинарник Hysteria 2

/usr/local/etc/xray/
└── geo/                              # geoip.dat / geosite.dat

/etc/systemd/system/
├── xray.service                      # перезаписан нашим юнитом
├── hysteria.service                  # перезаписан нашим юнитом
└── panel.service

/etc/caddy/
└── Caddyfile                         # reverse proxy для панели

/etc/letsencrypt/live/<hy2-domain>/   # сертификаты Hysteria
├── fullchain.pem
└── privkey.pem
```

**Владелец и права:**

- `/opt/mypanel/` — владелец `panel:panel` (создаваемый системный пользователь), 750.
- `.env` — `panel:panel`, 600 (только чтение владельцем).
- `configs/*` — `panel:panel`, 640.
- Xray и Hysteria бегают от своих системных пользователей (`xray`, `hysteria`), созданных их install-скриптами.
- Панель ходит в конфиги ядер через `sudo` с конкретными правилами в `/etc/sudoers.d/panel`.

---

## 5. Модель данных

### Схема PostgreSQL

```sql
-- users: корень всего
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username        TEXT UNIQUE NOT NULL CHECK (username ~ '^[a-zA-Z0-9_-]{3,32}$'),
    vless_uuid      UUID UNIQUE NOT NULL,
    hy2_password    TEXT UNIQUE NOT NULL,
    sub_token       TEXT UNIQUE NOT NULL,
    traffic_limit   BIGINT NOT NULL DEFAULT 0,       -- байты, 0 = безлимит
    traffic_used    BIGINT NOT NULL DEFAULT 0,
    expires_at      TIMESTAMPTZ,                      -- NULL = бессрочно
    status          TEXT NOT NULL DEFAULT 'active',   -- active|disabled|expired|limited
    note            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_sub_token ON users(sub_token);
CREATE INDEX idx_users_vless_uuid ON users(vless_uuid);
CREATE INDEX idx_users_hy2_password ON users(hy2_password);
CREATE INDEX idx_users_status_expires ON users(status, expires_at);

-- traffic_log: для графиков, чистится через 30 дней
CREATE TABLE traffic_log (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    core            TEXT NOT NULL,                    -- 'xray' | 'hysteria'
    uplink          BIGINT NOT NULL,
    downlink        BIGINT NOT NULL,
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_traffic_user_time ON traffic_log(user_id, recorded_at);
CREATE INDEX idx_traffic_recorded ON traffic_log(recorded_at);

-- admins: аутентификация админов
CREATE TABLE admins (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username        TEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,                    -- argon2id
    totp_secret     TEXT,                             -- NULL пока 2FA не включено
    role            TEXT NOT NULL DEFAULT 'admin',    -- admin|readonly
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- settings: runtime-параметры (меняются без рестарта панели)
CREATE TABLE settings (
    key             TEXT PRIMARY KEY,
    value           JSONB NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- config_history: откат редактора конфигов
CREATE TABLE config_history (
    id              BIGSERIAL PRIMARY KEY,
    core            TEXT NOT NULL,                    -- 'xray' | 'hysteria'
    content         TEXT NOT NULL,
    applied_by      UUID REFERENCES admins(id),
    applied_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    note            TEXT
);
CREATE INDEX idx_config_history_core_time ON config_history(core, applied_at DESC);

-- audit_log: кто что когда сделал
CREATE TABLE audit_log (
    id              BIGSERIAL PRIMARY KEY,
    admin_id        UUID REFERENCES admins(id),
    action          TEXT NOT NULL,                    -- 'user.create', 'config.apply', etc
    target_type     TEXT,                             -- 'user' | 'config' | 'settings'
    target_id       TEXT,
    metadata        JSONB,
    ip              INET,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_admin_time ON audit_log(admin_id, created_at DESC);
```

### Начальные настройки (settings)

После первой миграции вставляются из .env:

```sql
INSERT INTO settings (key, value) VALUES
  ('panel.domain',            '"panel.example.com"'),
  ('reality.sni',             '"www.cloudflare.com"'),
  ('reality.dest',            '"www.cloudflare.com:443"'),
  ('reality.public_key',      '"<auto>"'),
  ('reality.short_ids',       '["", "a1b2c3d4e5f60718"]'),
  ('vless.port',              '443'),
  ('hy2.domain',              '"panel.example.com"'),
  ('hy2.port',                '8443'),
  ('hy2.obfs_enabled',        'true'),
  ('hy2.bandwidth_up',        '"1 gbps"'),
  ('hy2.bandwidth_down',      '"1 gbps"'),
  ('hy2.masquerade_url',      '"https://www.bing.com"');
```

`settings` читаются бэкендом при каждом запросе (через кэш с инвалидацией при UPDATE) — это позволяет менять их из UI без рестарта.

---

## 6. Бэкенд: структура и слои

### Структура каталогов

```
backend/
├── cmd/
│   └── panel/
│       └── main.go                   # точка входа, wiring всех компонентов
├── internal/
│   ├── config/
│   │   └── config.go                 # парсинг .env → struct Config
│   ├── db/
│   │   ├── db.go                     # pgxpool инициализация
│   │   ├── migrations/               # .sql файлы goose
│   │   └── tx.go                     # helper для транзакций
│   ├── domain/
│   │   ├── user.go                   # модель User + методы CanConnect, etc
│   │   ├── admin.go
│   │   ├── settings.go
│   │   └── errors.go                 # типизированные ошибки домена
│   ├── repo/
│   │   ├── users.go                  # CRUD users
│   │   ├── admins.go
│   │   ├── traffic.go
│   │   ├── settings.go
│   │   └── audit.go
│   ├── cores/
│   │   ├── xray/
│   │   │   ├── client.go             # gRPC клиент + обёртки
│   │   │   ├── users.go              # AddUser / RemoveUser / ListUsers
│   │   │   ├── stats.go              # QueryStats
│   │   │   ├── proto/                # сгенерированные Go-файлы из .proto
│   │   │   └── config.go             # рендер config.json из шаблона
│   │   └── hysteria/
│   │       ├── client.go             # HTTP клиент
│   │       ├── traffic.go            # GetTraffic / Kick
│   │       ├── authhook.go           # обработчик /hy2/auth
│   │       └── config.go             # рендер config.yaml
│   ├── services/
│   │   ├── users.go                  # UserService: координация БД + Xray + кэш
│   │   ├── subscription.go           # SubService: /sub/<token>
│   │   ├── traffic.go                # TrafficService: агрегация
│   │   ├── settings.go               # SettingsService: применение настроек с рестартом
│   │   ├── configs.go                # ConfigService: редактор JSON с dry-run
│   │   └── auth.go                   # AuthService: JWT, логин, рефреш
│   ├── cache/
│   │   └── users.go                  # in-memory кэш для hy2 webhook
│   ├── api/
│   │   ├── server.go                 # Fiber app factory
│   │   ├── router.go                 # все маршруты
│   │   ├── middleware/
│   │   │   ├── jwt.go
│   │   │   ├── ratelimit.go
│   │   │   ├── cors.go
│   │   │   ├── audit.go
│   │   │   └── recover.go
│   │   └── handlers/
│   │       ├── auth.go               # login / refresh
│   │       ├── users.go              # CRUD юзеров
│   │       ├── sub.go                # GET /sub/:token
│   │       ├── hyauth.go             # POST /hy2/auth
│   │       ├── configs.go            # редактор конфигов ядер
│   │       ├── settings.go
│   │       ├── stats.go              # дашборд
│   │       ├── health.go             # /healthz
│   │       └── metrics.go            # /metrics
│   ├── tasks/
│   │   ├── scheduler.go              # тикеры с recover и mutex
│   │   ├── collector.go              # сбор трафика
│   │   ├── reconciler.go             # sync БД ↔ Xray
│   │   ├── enforcer.go               # лимиты + expiry
│   │   ├── cache_refresh.go          # fallback обновление кэша
│   │   └── backup.go                 # ежедневный pg_dump
│   ├── systemctl/
│   │   └── systemctl.go              # обёртка над systemctl restart xray/hysteria
│   └── util/
│       ├── password.go               # argon2id хеш + verify
│       ├── token.go                  # crypto/rand генерация токенов
│       └── humanize.go               # formatBytes, formatDuration
├── templates/
│   ├── xray.config.json.tmpl
│   └── hysteria.config.yaml.tmpl
├── migrations/
│   ├── 001_init.sql
│   ├── 002_seed_settings.sql
│   └── 003_audit_log.sql
├── Makefile
├── go.mod
└── go.sum
```

### Правила слоёв

**Никто не прыгает через слой:**

- `handlers` → только `services`, никогда напрямую в `repo` или `cores`.
- `services` → `repo`, `cores`, `cache`. Никогда в `handlers`.
- `cores` → только внешние API (gRPC, HTTP). Не знают про `services`, `repo`, `domain`.
- `repo` → только БД. Возвращает `domain.*` типы.
- `tasks` → `services`. Это просто триггеры по расписанию.

### Dependency injection через main.go

```go
func main() {
    cfg := config.Load()
    logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

    pool := db.Connect(cfg.DB)
    defer pool.Close()

    // repos
    userRepo := repo.NewUsersRepo(pool)
    // ...

    // cores
    xrayClient := xray.NewClient(cfg.Xray)
    hysteriaClient := hysteria.NewClient(cfg.Hysteria)

    // cache
    userCache := cache.NewUsersCache(userRepo, logger)
    if err := userCache.LoadAll(ctx); err != nil {
        logger.Error("cache load failed", "err", err)
        os.Exit(1)
    }
    
    // services
    userService := services.NewUserService(userRepo, xrayClient, userCache, logger)
    // ...

    // startup sync — панель не принимает запросов пока ядра не синхронизированы
    reconciler := tasks.NewReconciler(userRepo, xrayClient, logger)
    if err := reconciler.Run(ctx); err != nil {
        logger.Error("initial sync failed", "err", err)
        os.Exit(1)
    }

    // background tasks
    scheduler := tasks.NewScheduler(logger)
    scheduler.Every("collector",    10*time.Second, collector.Run)
    scheduler.Every("enforcer",     30*time.Second, enforcer.Run)
    scheduler.Every("reconciler",   60*time.Second, reconciler.Run)
    scheduler.Every("cache_refresh", 5*time.Minute,  userCache.Refresh)
    scheduler.Every("backup",       24*time.Hour,   backup.Run)
    go scheduler.Start(ctx)

    // HTTP
    app := api.NewServer(cfg, services, logger)
    go app.Listen(cfg.PanelAddr)
    
    // sd_notify(READY=1) — systemd знает что стартовали
    daemon.SdNotify(false, daemon.SdNotifyReady)

    // graceful shutdown
    waitForSignal()
    shutdown(ctx, app, scheduler, pool)
}
```

### Модель User

```go
package domain

type UserStatus string

const (
    StatusActive   UserStatus = "active"
    StatusDisabled UserStatus = "disabled"
    StatusExpired  UserStatus = "expired"
    StatusLimited  UserStatus = "limited"
)

type User struct {
    ID           uuid.UUID
    Username     string
    VlessUUID    uuid.UUID
    Hy2Password  string
    SubToken     string
    TrafficLimit int64
    TrafficUsed  int64
    ExpiresAt    *time.Time
    Status       UserStatus
    Note         string
    CreatedAt    time.Time
    UpdatedAt    time.Time
}

// CanConnect — единственный источник истины для проверки доступа
func (u *User) CanConnect() bool {
    if u.Status != StatusActive {
        return false
    }
    if u.ExpiresAt != nil && u.ExpiresAt.Before(time.Now()) {
        return false
    }
    if u.TrafficLimit > 0 && u.TrafficUsed >= u.TrafficLimit {
        return false
    }
    return true
}

func (u *User) IsExpired() bool {
    return u.ExpiresAt != nil && u.ExpiresAt.Before(time.Now())
}

func (u *User) IsOverLimit() bool {
    return u.TrafficLimit > 0 && u.TrafficUsed >= u.TrafficLimit
}
```

### UserService.Create — пример координации

```go
func (s *UserService) Create(ctx context.Context, req CreateUserRequest, adminID uuid.UUID) (*domain.User, error) {
    user := &domain.User{
        ID:           uuid.New(),
        Username:     req.Username,
        VlessUUID:    uuid.New(),
        Hy2Password:  util.RandomToken(24),
        SubToken:     util.RandomToken(32),
        TrafficLimit: req.TrafficLimit,
        ExpiresAt:    req.ExpiresAt,
        Status:       domain.StatusActive,
        Note:         req.Note,
    }
    
    // 1. БД (источник истины)
    if err := s.repo.Create(ctx, user); err != nil {
        return nil, err
    }
    
    // 2. Xray (hot-add через gRPC)
    if err := s.xray.AddUser(ctx, user); err != nil {
        _ = s.repo.Delete(ctx, user.ID)  // откат
        return nil, fmt.Errorf("xray add user: %w", err)
    }
    
    // 3. Кэш для Hysteria webhook
    s.cache.Set(user)
    
    // 4. Audit
    s.audit.Log(ctx, adminID, "user.create", "user", user.ID.String(), nil)
    
    return user, nil
}
```

---

## 7. Интеграция с ядрами

### 7.1 Xray: gRPC клиент

**Подготовка proto.** Из `github.com/XTLS/Xray-core` забрать:
- `app/proxyman/command/command.proto`
- `app/stats/command/command.proto`
- `common/protocol/user.proto`
- `proxy/vless/account.proto`
- `common/serial/typed_message.proto`

Сгенерировать через `protoc` с `--go_out` и `--go-grpc_out`, сложить в `internal/cores/xray/proto/`. В Makefile добавить target `make proto` для регенерации при обновлении Xray.

**Клиент:**

```go
package xray

type Client struct {
    conn    *grpc.ClientConn
    handler commandpb.HandlerServiceClient
    stats   statspb.StatsServiceClient
    inbound string            // "vless-reality"
    logger  *slog.Logger
}

func NewClient(cfg Config, logger *slog.Logger) (*Client, error) {
    conn, err := grpc.NewClient(
        cfg.APIAddr,  // "127.0.0.1:10085"
        grpc.WithTransportCredentials(insecure.NewCredentials()),
        grpc.WithKeepaliveParams(keepalive.ClientParameters{
            Time:    30 * time.Second,
            Timeout: 5 * time.Second,
        }),
    )
    if err != nil {
        return nil, err
    }
    return &Client{
        conn:    conn,
        handler: commandpb.NewHandlerServiceClient(conn),
        stats:   statspb.NewStatsServiceClient(conn),
        inbound: cfg.InboundTag,
        logger:  logger,
    }, nil
}

// WaitReady — блокируется пока Xray не ответит. Вызывается при старте панели.
func (c *Client) WaitReady(ctx context.Context, timeout time.Duration) error {
    ctx, cancel := context.WithTimeout(ctx, timeout)
    defer cancel()
    
    for {
        _, err := c.stats.GetSysStats(ctx, &statspb.SysStatsRequest{})
        if err == nil {
            return nil
        }
        select {
        case <-ctx.Done():
            return fmt.Errorf("xray not ready: %w", err)
        case <-time.After(500 * time.Millisecond):
        }
    }
}
```

**AddUser / RemoveUser (идемпотентные):**

```go
func (c *Client) AddUser(ctx context.Context, u *domain.User) error {
    return c.do(ctx, func(ctx context.Context) error {
        op := &commandpb.AddUserOperation{
            User: &protocolpb.User{
                Email: u.Username,
                Level: 0,
                Account: serial.ToTypedMessage(&vlesspb.Account{
                    Id:   u.VlessUUID.String(),
                    Flow: "xtls-rprx-vision",
                }),
            },
        }
        _, err := c.handler.AlterInbound(ctx, &commandpb.AlterInboundRequest{
            Tag:       c.inbound,
            Operation: serial.ToTypedMessage(op),
        })
        // AlreadyExists — не ошибка, идемпотентность
        if status.Code(err) == codes.AlreadyExists {
            return nil
        }
        // Xray может вернуть "already exists" как обычный error
        if err != nil && strings.Contains(err.Error(), "already exists") {
            return nil
        }
        return err
    })
}

func (c *Client) RemoveUser(ctx context.Context, username string) error {
    return c.do(ctx, func(ctx context.Context) error {
        op := &commandpb.RemoveUserOperation{Email: username}
        _, err := c.handler.AlterInbound(ctx, &commandpb.AlterInboundRequest{
            Tag:       c.inbound,
            Operation: serial.ToTypedMessage(op),
        })
        if status.Code(err) == codes.NotFound {
            return nil
        }
        if err != nil && strings.Contains(err.Error(), "not found") {
            return nil
        }
        return err
    })
}
```

**QueryStats с reset:**

```go
type TrafficDelta struct {
    Uplink   int64
    Downlink int64
}

func (c *Client) QueryStats(ctx context.Context) (map[string]TrafficDelta, error) {
    resp, err := c.stats.QueryStats(ctx, &statspb.QueryStatsRequest{
        Pattern: "user>>>",
        Reset_:  true,  // ВАЖНО: без reset будут абсолютные значения
    })
    if err != nil {
        return nil, err
    }
    
    result := make(map[string]TrafficDelta)
    for _, s := range resp.Stat {
        // имя: "user>>>alice>>>traffic>>>uplink"
        parts := strings.Split(s.Name, ">>>")
        if len(parts) != 4 || parts[0] != "user" {
            continue
        }
        username, direction := parts[1], parts[3]
        td := result[username]
        switch direction {
        case "uplink":
            td.Uplink = s.Value
        case "downlink":
            td.Downlink = s.Value
        }
        result[username] = td
    }
    return result, nil
}

// ListUsers — нужен для reconciler.
// Xray gRPC не даёт прямого списка клиентов, но через QueryStats можно получить
// всех юзеров, у которых был хоть один байт. Для полноты — сохраняем также
// результат последнего AddUser в локальном snapshot.
func (c *Client) ListUsers(ctx context.Context) ([]string, error) {
    resp, err := c.stats.QueryStats(ctx, &statspb.QueryStatsRequest{
        Pattern: "user>>>",
        Reset_:  false,  // не сбрасываем!
    })
    if err != nil {
        return nil, err
    }
    set := make(map[string]bool)
    for _, s := range resp.Stat {
        parts := strings.Split(s.Name, ">>>")
        if len(parts) >= 2 {
            set[parts[1]] = true
        }
    }
    users := make([]string, 0, len(set))
    for u := range set {
        users = append(users, u)
    }
    return users, nil
}
```

**do() — retry wrapper:**

```go
func (c *Client) do(ctx context.Context, fn func(context.Context) error) error {
    return retry.Do(
        func() error {
            ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
            defer cancel()
            return fn(ctx)
        },
        retry.Attempts(3),
        retry.Delay(100*time.Millisecond),
        retry.DelayType(retry.BackOffDelay),
        retry.RetryIf(func(err error) bool {
            code := status.Code(err)
            return code == codes.Unavailable || code == codes.DeadlineExceeded
        }),
        retry.Context(ctx),
    )
}
```

### 7.2 Hysteria: HTTP клиент и webhook

**Клиент Traffic API:**

```go
package hysteria

type Client struct {
    baseURL string   // "http://127.0.0.1:7653"
    secret  string
    http    *http.Client
}

type Traffic struct {
    Tx int64 `json:"tx"`
    Rx int64 `json:"rx"`
}

func (c *Client) GetTraffic(ctx context.Context, clear bool) (map[string]Traffic, error) {
    url := c.baseURL + "/traffic"
    if clear {
        url += "?clear=1"  // ВАЖНО: без этого получим абсолютные значения
    }
    req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
    req.Header.Set("Authorization", c.secret)
    
    resp, err := c.http.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    
    if resp.StatusCode != 200 {
        return nil, fmt.Errorf("traffic api: %d", resp.StatusCode)
    }
    
    var out map[string]Traffic
    return out, json.NewDecoder(resp.Body).Decode(&out)
}

func (c *Client) Kick(ctx context.Context, users []string) error {
    body, _ := json.Marshal(users)
    req, _ := http.NewRequestWithContext(ctx, "POST", c.baseURL+"/kick", bytes.NewReader(body))
    req.Header.Set("Authorization", c.secret)
    req.Header.Set("Content-Type", "application/json")
    resp, err := c.http.Do(req)
    if err != nil {
        return err
    }
    defer resp.Body.Close()
    if resp.StatusCode >= 400 {
        return fmt.Errorf("kick failed: %d", resp.StatusCode)
    }
    return nil
}
```

**Auth webhook (приёмник) — самый критичный код в системе:**

```go
package hysteria

type AuthRequest struct {
    Addr string `json:"addr"`
    Auth string `json:"auth"`
    Tx   int64  `json:"tx"`
}

type AuthResponse struct {
    Ok bool   `json:"ok"`
    ID string `json:"id,omitempty"`
}

func AuthHandler(cache *cache.Cache, logger *slog.Logger) fiber.Handler {
    // anti-flood: один токен не чаще 10 запросов/сек
    limiter := NewPerTokenRateLimiter(10, time.Second)
    
    return func(c *fiber.Ctx) error {
        // слой 1: источник должен быть localhost
        ip := c.IP()
        if !strings.HasPrefix(ip, "127.") && ip != "::1" {
            logger.Warn("hy2 auth from non-local", "ip", ip)
            return c.SendStatus(403)
        }
        
        var req AuthRequest
        if err := c.BodyParser(&req); err != nil {
            return c.JSON(AuthResponse{Ok: false})
        }
        
        // слой 2: анти-флуд
        if !limiter.Allow(req.Auth) {
            return c.JSON(AuthResponse{Ok: false})
        }
        
        // слой 3: кэш (БД НЕ трогаем!)
        user, ok := cache.GetByHy2Password(req.Auth)
        if !ok || !user.CanConnect() {
            return c.JSON(AuthResponse{Ok: false})
        }
        
        return c.JSON(AuthResponse{Ok: true, ID: user.Username})
    }
}
```

### 7.3 Генерация конфигов ядер

Настройки хранятся в таблице `settings`. При применении новых настроек:

1. `SettingsService.Apply(changes)` — валидирует.
2. Пишет в БД.
3. `ConfigService.RenderXray()` — рендерит `configs/xray/config.json` из шаблона + БД.
4. `ConfigService.RenderHysteria()` — рендерит `configs/hysteria/config.yaml`.
5. Делает бэкап старого конфига в `config.json.bak`.
6. `systemctl.Restart("xray")` или `restart("hysteria")` в зависимости от того, что изменилось.
7. Ждёт healthcheck до 10 секунд. Если не поднялось — восстанавливает `.bak` и рестартует обратно.

---

## 8. Фоновые задачи

### 8.1 Scheduler — общий каркас

```go
type Task struct {
    Name     string
    Interval time.Duration
    Fn       func(context.Context) error
    mu       sync.Mutex
}

func (s *Scheduler) run(ctx context.Context, t *Task) {
    ticker := time.NewTicker(t.Interval)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            if !t.mu.TryLock() {
                s.logger.Warn("task overlap", "task", t.Name)
                continue
            }
            go func() {
                defer t.mu.Unlock()
                defer func() {
                    if r := recover(); r != nil {
                        s.logger.Error("task panic", "task", t.Name, "recover", r,
                            "stack", string(debug.Stack()))
                    }
                }()
                tctx, cancel := context.WithTimeout(ctx, t.Interval*2)
                defer cancel()
                start := time.Now()
                err := t.Fn(tctx)
                // метрика
                taskDuration.WithLabelValues(t.Name).Observe(time.Since(start).Seconds())
                if err != nil {
                    taskErrors.WithLabelValues(t.Name).Inc()
                    s.logger.Error("task failed", "task", t.Name, "err", err)
                }
            }()
        }
    }
}
```

### 8.2 Collector (каждые 10с)

```go
func (t *Collector) Run(ctx context.Context) error {
    // 1. Xray
    xStats, err := t.xray.QueryStats(ctx)
    if err != nil {
        t.logger.Warn("xray stats failed", "err", err)
    } else if len(xStats) > 0 {
        if err := t.repo.AddTrafficBatch(ctx, "xray", xStats); err != nil {
            return fmt.Errorf("save xray traffic: %w", err)
        }
    }
    
    // 2. Hysteria
    hStats, err := t.hysteria.GetTraffic(ctx, true)
    if err != nil {
        t.logger.Warn("hysteria traffic failed", "err", err)
    } else if len(hStats) > 0 {
        hDeltas := make(map[string]TrafficDelta, len(hStats))
        for username, tr := range hStats {
            hDeltas[username] = TrafficDelta{Uplink: tr.Tx, Downlink: tr.Rx}
        }
        if err := t.repo.AddTrafficBatch(ctx, "hysteria", hDeltas); err != nil {
            return fmt.Errorf("save hysteria traffic: %w", err)
        }
    }
    
    return nil
}
```

**AddTrafficBatch** — один запрос на всех юзеров:

```sql
-- обновление накопленного трафика
UPDATE users 
SET traffic_used = traffic_used + t.bytes, updated_at = now()
FROM (VALUES ('alice', 1024::bigint), ('bob', 2048::bigint)) AS t(username, bytes)
WHERE users.username = t.username;

-- запись в лог
INSERT INTO traffic_log (user_id, core, uplink, downlink, recorded_at)
SELECT u.id, $1, t.up, t.down, now()
FROM (VALUES ('alice', 512::bigint, 512::bigint)) AS t(username, up, down)
JOIN users u ON u.username = t.username;
```

### 8.3 Enforcer (каждые 30с)

```go
func (t *Enforcer) Run(ctx context.Context) error {
    offenders, err := t.repo.FindOffenders(ctx)
    if err != nil {
        return err
    }
    
    for _, u := range offenders {
        newStatus := domain.StatusLimited
        if u.IsExpired() {
            newStatus = domain.StatusExpired
        }
        
        if err := t.repo.UpdateStatus(ctx, u.ID, newStatus); err != nil {
            t.logger.Error("enforcer update", "user", u.Username, "err", err)
            continue
        }
        
        if err := t.xray.RemoveUser(ctx, u.Username); err != nil {
            t.logger.Warn("enforcer xray remove", "user", u.Username, "err", err)
        }
        _ = t.hysteria.Kick(ctx, []string{u.Username})
        t.cache.Delete(&u)
    }
    return nil
}
```

### 8.4 Reconciler (каждые 60с)

```go
func (t *Reconciler) Run(ctx context.Context) error {
    dbActive, err := t.repo.ListActive(ctx)
    if err != nil {
        return err
    }
    
    xrayUsers, err := t.xray.ListUsers(ctx)
    if err != nil {
        return err  // если Xray недоступен, пропускаем итерацию
    }
    
    dbSet := make(map[string]*domain.User, len(dbActive))
    for i := range dbActive {
        dbSet[dbActive[i].Username] = &dbActive[i]
    }
    xraySet := make(map[string]bool, len(xrayUsers))
    for _, u := range xrayUsers {
        xraySet[u] = true
    }
    
    // лишние в Xray → удалить
    for _, u := range xrayUsers {
        if _, ok := dbSet[u]; !ok {
            if err := t.xray.RemoveUser(ctx, u); err != nil {
                t.logger.Warn("reconcile remove", "user", u, "err", err)
            }
        }
    }
    
    // недостающие в Xray → добавить
    for _, u := range dbActive {
        if !xraySet[u.Username] {
            if err := t.xray.AddUser(ctx, &u); err != nil {
                t.logger.Warn("reconcile add", "user", u.Username, "err", err)
            }
        }
    }
    return nil
}
```

### 8.5 Cache refresh (каждые 5 минут)

Полная перезагрузка кэша из БД — страховка от потери события инвалидации.

### 8.6 Backup (ежедневно в 03:00 UTC)

```go
func (t *Backup) Run(ctx context.Context) error {
    filename := fmt.Sprintf("panel-%s.sql.gz", time.Now().UTC().Format("2006-01-02"))
    path := filepath.Join(t.dir, filename)
    
    cmd := exec.CommandContext(ctx, "sh", "-c",
        fmt.Sprintf("pg_dump -U %s %s | gzip > %s", t.dbUser, t.dbName, path))
    cmd.Env = append(os.Environ(), "PGPASSWORD="+t.dbPass)
    if err := cmd.Run(); err != nil {
        return err
    }
    return t.rotateOld(14)  // оставить 14 последних
}
```

---

## 9. HTTP API

### Маршруты

**Публичные (без JWT):**

| Метод | Путь | Назначение |
|-------|------|------------|
| POST | `/api/auth/login` | Логин админа, возвращает access JWT + refresh cookie |
| POST | `/api/auth/refresh` | Обновление access по refresh cookie |
| POST | `/api/auth/logout` | Удаляет refresh cookie |
| GET | `/sub/:token` | Подписка пользователя (рендер URI) |
| POST | `/sub/:token/rotate` | Пользователь сам ротирует свой токен |
| POST | `/hy2/auth` | Webhook для Hysteria (только с 127.0.0.1) |
| GET | `/healthz` | Статус (db, xray, hysteria) |
| GET | `/metrics` | Prometheus метрики |

**Админские (JWT обязателен):**

| Метод | Путь | Назначение |
|-------|------|------------|
| GET | `/api/users` | Список с пагинацией, поиском, фильтрами |
| POST | `/api/users` | Создать |
| GET | `/api/users/:id` | Детали |
| PATCH | `/api/users/:id` | Обновить (лимит, срок, статус, note) |
| DELETE | `/api/users/:id` | Удалить |
| POST | `/api/users/:id/reset-sub` | Новый sub_token |
| POST | `/api/users/:id/reset-traffic` | Обнулить traffic_used |
| GET | `/api/users/:id/traffic` | График трафика за N дней |
| GET | `/api/users/:id/links` | subscription + vless URI + hy2 URI + QR |
| GET | `/api/configs/:core` | Текущий конфиг (xray или hysteria) |
| POST | `/api/configs/:core/validate` | Dry-run проверка конфига |
| POST | `/api/configs/:core/apply` | Применить (с рестартом ядра) |
| GET | `/api/configs/:core/history` | Последние 20 версий |
| POST | `/api/configs/:core/restore/:id` | Откатиться на версию |
| GET | `/api/settings` | Все runtime-настройки |
| PATCH | `/api/settings` | Частичное обновление (может потребовать рестарт) |
| GET | `/api/stats/overview` | Дашборд: активные, трафик за день, статус ядер |
| GET | `/api/stats/traffic` | Суммарный трафик за период |
| GET | `/api/stats/online` | Онлайн-юзеры сейчас |
| GET | `/api/admins` | Список админов |
| POST | `/api/admins` | Создать |
| PATCH | `/api/admins/:id` | Смена пароля, 2FA |
| DELETE | `/api/admins/:id` | Удалить (нельзя последнего) |
| GET | `/api/audit` | Журнал операций |

### Middleware стек

Порядок применения сверху вниз:

```
recover → requestID → logger → cors → ratelimit → jwt (не для public) → audit → handler
```

- **recover** — ловит panic, отвечает 500, логирует stack trace.
- **requestID** — UUID в заголовок `X-Request-ID`, пробрасывается в логи.
- **logger** — structured лог каждого запроса (метод, путь, статус, длительность, IP).
- **cors** — разрешён только свой домен панели.
- **ratelimit** — глобальный 100 req/min на IP для всех, локальные для `/auth/login` (5/min) и `/sub/*` (60/min).
- **jwt** — парсит Bearer, кладёт admin_id в context. Для публичных маршрутов пропускается.
- **audit** — для мутирующих запросов пишет запись в `audit_log`.

### Форматы ответов

Единый формат ошибки:

```json
{
  "error": {
    "code": "user_not_found",
    "message": "User with given id does not exist"
  }
}
```

Успешный ответ:

```json
{
  "data": { ... },
  "meta": { "page": 1, "per_page": 20, "total": 142 }
}
```

`meta` только там где нужен (пагинация, агрегации).

### Пример: POST /api/users

**Request:**

```json
{
  "username": "alice",
  "traffic_limit": 53687091200,
  "expires_at": "2026-12-31T23:59:59Z",
  "note": "Друг из Риги"
}
```

**Response 201:**

```json
{
  "data": {
    "id": "8a7b6c5d-...",
    "username": "alice",
    "status": "active",
    "traffic_limit": 53687091200,
    "traffic_used": 0,
    "expires_at": "2026-12-31T23:59:59Z",
    "sub_url": "https://panel.example.com/sub/abc123...",
    "created_at": "2026-04-19T10:00:00Z"
  }
}
```

**Response 409:**

```json
{"error": {"code": "user_already_exists", "message": "Username is already taken"}}
```

### Пример: GET /api/users/:id/links

```json
{
  "data": {
    "subscription": "https://panel.example.com/sub/abc123...",
    "vless": "vless://uuid@domain:443?type=tcp&security=reality&...",
    "hysteria2": "hysteria2://pass@domain:8443/?sni=...&obfs=salamander&...",
    "qr": {
      "subscription": "data:image/png;base64,iVBOR...",
      "vless": "data:image/png;base64,iVBOR...",
      "hysteria2": "data:image/png;base64,iVBOR..."
    }
  }
}
```

QR-коды генерируются на бэке (одна библиотека, консистентно).

---

## 10. Subscription и формат URI

### Endpoint `/sub/:token`

```go
func (h *SubHandler) Get(c *fiber.Ctx) error {
    token := c.Params("token")
    if len(token) < 32 {
        return c.SendStatus(404)
    }
    
    user, err := h.svc.GetByToken(c.Context(), token)
    if err != nil {
        return c.SendStatus(404)  // никаких подсказок
    }
    
    vless := h.svc.BuildVlessURI(user)
    hy2   := h.svc.BuildHysteria2URI(user)
    
    content := vless + "\n" + hy2
    encoded := base64.StdEncoding.EncodeToString([]byte(content))
    
    // User-Agent → разные форматы
    ua := strings.ToLower(c.Get("User-Agent"))
    switch {
    case strings.Contains(ua, "clash"):
        return c.SendString(h.svc.BuildClashYAML(user))
    case strings.Contains(ua, "sing-box"):
        return c.JSON(h.svc.BuildSingBoxJSON(user))
    default:
        c.Set("Content-Type", "text/plain; charset=utf-8")
        c.Set("Profile-Update-Interval", "24")
        c.Set("Subscription-Userinfo", h.svc.BuildUserInfoHeader(user))
        c.Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, user.Username))
        return c.SendString(encoded)
    }
}
```

### Заголовок Subscription-Userinfo

Стандарт, читаемый всеми мажорными клиентами (v2rayN, Streisand, Hiddify, Karing):

```
Subscription-Userinfo: upload=0; download=4294967296; total=53687091200; expire=1767225599
```

- `upload` — всегда 0 (суммируем с `download` в `traffic_used`).
- `download` — `user.traffic_used`.
- `total` — `user.traffic_limit` (0 если безлимит).
- `expire` — Unix timestamp, 0 если бессрочно.

### Формат VLESS URI

```
vless://<UUID>@<domain>:<port>?
  type=tcp&
  security=reality&
  pbk=<reality_public_key>&
  sni=<reality_sni>&
  fp=chrome&
  flow=xtls-rprx-vision&
  sid=<short_id>&
  spx=<spider_x>
#<label>
```

Фрагмент `#label` — URL-encoded имя пользователя + "-VLESS" для опознания в клиенте.

### Формат Hysteria 2 URI

```
hysteria2://<password>@<domain>:<port>/?
  sni=<sni>&
  insecure=0&
  obfs=salamander&
  obfs-password=<obfs_password>&
  pinSHA256=<optional>
#<label>
```

Если obfs выключен — параметры `obfs` и `obfs-password` не добавляются.

### Генерация QR

Используем библиотеку `github.com/skip2/go-qrcode` или `github.com/yeqown/go-qrcode`. Возвращаем `data:image/png;base64,...` для прямого использования в `<img src="...">`.

### Роутинг клиентов

На странице `/u/:token` определяем ОС по User-Agent и показываем соответствующие deep links:

```ts
const links = {
  ios: {
    streisand:     `streisand://import/${encodeURIComponent(subUrl)}`,
    shadowrocket:  `shadowrocket://add/sub://${btoa(subUrl)}`,
    karing:        `karing://install-config?url=${encodeURIComponent(subUrl)}`,
  },
  android: {
    v2rayng:   `v2rayng://install-sub/?url=${encodeURIComponent(subUrl)}`,
    hiddify:   `hiddify://install-config?url=${encodeURIComponent(subUrl)}`,
    karing:    `karing://install-config?url=${encodeURIComponent(subUrl)}`,
  },
  desktop: {
    singbox:   `sing-box://import-remote-profile?url=${encodeURIComponent(subUrl)}`,
    hiddify:   `hiddify://install-config?url=${encodeURIComponent(subUrl)}`,
  },
};
```

---

## 11. Шаблоны конфигов ядер

### Xray (`templates/xray.config.json.tmpl`)

```json
{
  "log": { "loglevel": "warning" },
  "api": {
    "tag": "api",
    "services": ["HandlerService", "StatsService"]
  },
  "stats": {},
  "policy": {
    "levels": {
      "0": {
        "statsUserUplink": true,
        "statsUserDownlink": true
      }
    },
    "system": {
      "statsInboundUplink": true,
      "statsInboundDownlink": true
    }
  },
  "inbounds": [
    {
      "tag": "api",
      "listen": "127.0.0.1",
      "port": 10085,
      "protocol": "dokodemo-door",
      "settings": { "address": "127.0.0.1" }
    },
    {
      "tag": "vless-reality",
      "listen": "0.0.0.0",
      "port": {{ .VlessPort }},
      "protocol": "vless",
      "settings": {
        "clients": [],
        "decryption": "none"
      },
      "streamSettings": {
        "network": "tcp",
        "security": "reality",
        "realitySettings": {
          "dest": "{{ .RealityDest }}",
          "serverNames": ["{{ .RealitySNI }}"],
          "privateKey": "{{ .RealityPrivateKey }}",
          "shortIds": [{{ range $i, $s := .RealityShortIds }}{{ if $i }},{{ end }}"{{ $s }}"{{ end }}]
        }
      },
      "sniffing": {
        "enabled": true,
        "destOverride": ["http", "tls", "quic"],
        "routeOnly": true
      }
    }
  ],
  "outbounds": [
    { "protocol": "freedom", "tag": "direct" },
    { "protocol": "blackhole", "tag": "block" }
  ],
  "routing": {
    "domainStrategy": "IPIfNonMatch",
    "rules": [
      { "type": "field", "inboundTag": ["api"], "outboundTag": "api" },
      { "type": "field", "protocol": ["bittorrent"], "outboundTag": "block" }
    ]
  }
}
```

**Важно:** `"clients": []` — пустой массив. Все юзеры добавляются через gRPC `AddUser` при старте reconciler'ом.

### Hysteria 2 (`templates/hysteria.config.yaml.tmpl`)

```yaml
listen: :{{ .Hy2Port }}

tls:
  cert: /etc/letsencrypt/live/{{ .Hy2Domain }}/fullchain.pem
  key: /etc/letsencrypt/live/{{ .Hy2Domain }}/privkey.pem

auth:
  type: http
  http:
    url: http://127.0.0.1:{{ .PanelPort }}/hy2/auth
    insecure: false

trafficStats:
  listen: 127.0.0.1:7653
  secret: {{ .Hy2TrafficSecret }}

{{ if .Hy2ObfsEnabled }}
obfs:
  type: salamander
  salamander:
    password: {{ .Hy2ObfsPassword }}
{{ end }}

bandwidth:
  up: {{ .Hy2BandwidthUp }}
  down: {{ .Hy2BandwidthDown }}

masquerade:
  type: proxy
  proxy:
    url: {{ .Hy2MasqueradeURL }}
    rewriteHost: true
```

Обратите внимание: **нет** секции `auth.password` или `auth.userpass`. Используется `auth.http` — пароли живут в БД панели, Hysteria при каждом подключении спрашивает панель.

### Валидация перед применением

Перед записью нового конфига:

```go
// Xray
func (s *ConfigService) ValidateXray(ctx context.Context, json []byte) error {
    tmp, err := os.CreateTemp("", "xray-*.json")
    if err != nil {
        return err
    }
    defer os.Remove(tmp.Name())
    tmp.Write(json)
    tmp.Close()
    
    out, err := exec.CommandContext(ctx, "/usr/local/bin/xray", "test", "-c", tmp.Name()).CombinedOutput()
    if err != nil {
        return fmt.Errorf("xray validation: %s", string(out))
    }
    return nil
}

// Hysteria — нативного --test нет, парсим YAML сами и проверяем обязательные поля
```

### Rollback при неудачном применении

```go
func (s *ConfigService) ApplyXray(ctx context.Context, newConfig []byte) error {
    oldPath := "/opt/mypanel/configs/xray/config.json"
    bakPath := "/opt/mypanel/configs/xray/config.json.bak"
    
    // 1. бэкап текущего
    if err := copyFile(oldPath, bakPath); err != nil {
        return err
    }
    
    // 2. записать новый
    if err := os.WriteFile(oldPath, newConfig, 0640); err != nil {
        return err
    }
    
    // 3. история
    s.repo.SaveHistory(ctx, "xray", string(newConfig), adminID)
    
    // 4. рестарт
    if err := s.systemctl.Restart("xray"); err != nil {
        // откат
        _ = copyFile(bakPath, oldPath)
        _ = s.systemctl.Restart("xray")
        return fmt.Errorf("restart failed: %w", err)
    }
    
    // 5. healthcheck до 10с
    if err := s.waitXrayHealthy(ctx, 10*time.Second); err != nil {
        _ = copyFile(bakPath, oldPath)
        _ = s.systemctl.Restart("xray")
        return fmt.Errorf("xray unhealthy after restart: %w", err)
    }
    
    return nil
}
```

---

## 12. Фронтенд: структура и UX

### Стек (ещё раз для справки)

Vite + React 19 + TypeScript + TailwindCSS 4 + shadcn/ui + TanStack Query + TanStack Router + React Hook Form + Zod + Monaco Editor + Recharts + Lucide + Sonner.

### Структура проекта

```
frontend/
├── src/
│   ├── main.tsx
│   ├── app/
│   │   ├── router.tsx
│   │   └── providers.tsx
│   ├── features/
│   │   ├── auth/
│   │   │   ├── LoginPage.tsx
│   │   │   └── useAuth.ts
│   │   ├── dashboard/
│   │   │   ├── DashboardPage.tsx
│   │   │   ├── OverviewCards.tsx
│   │   │   ├── TrafficChart.tsx
│   │   │   └── OnlineUsersList.tsx
│   │   ├── users/
│   │   │   ├── UsersPage.tsx
│   │   │   ├── UserTable.tsx
│   │   │   ├── UserDrawer.tsx
│   │   │   ├── CreateUserDialog.tsx
│   │   │   ├── UserLinksPanel.tsx   # QR, URI, ссылка подписки
│   │   │   └── useUsers.ts
│   │   ├── configs/
│   │   │   ├── ConfigsPage.tsx
│   │   │   ├── XrayEditor.tsx
│   │   │   ├── HysteriaEditor.tsx
│   │   │   ├── DiffDialog.tsx
│   │   │   ├── HistoryDialog.tsx
│   │   │   └── useConfig.ts
│   │   ├── settings/
│   │   │   ├── SettingsPage.tsx
│   │   │   ├── ProtocolsTab.tsx
│   │   │   ├── DomainsTab.tsx
│   │   │   └── AdminsTab.tsx
│   │   ├── audit/
│   │   │   └── AuditPage.tsx
│   │   └── subscription/            # ПУБЛИЧНАЯ часть
│   │       ├── SubPage.tsx
│   │       ├── QRBlock.tsx
│   │       ├── ClientButtons.tsx
│   │       ├── UsageBar.tsx
│   │       └── InstructionsAccordion.tsx
│   ├── shared/
│   │   ├── api/
│   │   │   ├── client.ts            # fetch wrapper + auto refresh
│   │   │   └── types.ts
│   │   ├── ui/                      # shadcn components
│   │   └── lib/
│   │       ├── format.ts
│   │       └── detectOS.ts
│   └── styles/
│       └── globals.css
├── index.html
├── vite.config.ts
└── tsconfig.json
```

### Ключевые UX-решения

**Две роли, два интерфейса:**

| Роль | Маршруты | Аутентификация |
|------|----------|----------------|
| Админ | `/login`, `/`, `/users`, `/configs/*`, `/settings`, `/audit` | JWT |
| Пользователь | `/u/:sub_token` | По токену в URL |

Пользователь **никогда** не видит админку и технических терминов (VLESS, Reality, SNI и т.д.).

### Админ-часть

**Dashboard (`/`):**
- Карточки: активных юзеров, онлайн сейчас, трафик за сутки, статус ядер.
- График трафика за неделю (Recharts area chart).
- Список последних 10 онлайн-юзеров с их IP и трафиком.
- Опрос через TanStack Query `refetchInterval: 5000`.

**UsersPage (`/users`):**
- Таблица с колонками: username, status badge, traffic (прогресс-бар), expires (дней осталось), created.
- Поиск по username (debounced 300ms).
- Фильтры: status (active/disabled/expired/limited), has_traffic_limit, near_expiry.
- Массовые операции: disable, enable, reset traffic, extend by N days.
- Клик на строку → drawer справа с деталями и редактированием.
- Виртуализированная (tanstack-virtual) при > 200 юзеров.

**UserDrawer:**
- Три таба: Details / Links / Traffic.
- **Details** — форма изменения лимита, срока, статуса, note. Сохранение на blur + debounce.
- **Links** — блок из трёх карточек (Subscription, VLESS, Hysteria 2), каждая с QR + copy + "reset token".
- **Traffic** — график за 7/30 дней + список последних подключений (если есть).

**CreateUserDialog:**
- Username — автогенерация `user_<6hex>`, можно заменить.
- Traffic limit — чипы "10GB / 50GB / 100GB / 500GB / Unlimited".
- Expires — чипы "7d / 30d / 90d / 365d / Never" + date picker.
- Note — опционально.

**ConfigsPage (`/configs/xray`, `/configs/hysteria`):**
- Monaco Editor на 70vh высоты.
- JSON Schema подключена → автодополнение, tooltips, inline ошибки.
- Поля `clients[]`, `privateKey`, `shortIds` подсвечиваются как read-only с пояснением.
- Кнопки сверху: "Validate" (dry-run), "Apply" (с confirm + diff), "History" (список откатов), "Reset" (откат несохранённого).
- Перед "Apply" — модалка с side-by-side diff (old vs new) и warning "Restart kernel, active connections will drop".
- После "Apply" — тост "Applied successfully, kernel restarted in 3.2s" или ошибка с рекомендацией.

**SettingsPage (`/settings`):**
- Табы: Protocols (порты, SNI, bandwidth), Domains (panel/hy2 домены), Security (rate limits, 2FA), Admins (CRUD админов).
- Каждое изменение помечается как "requires restart" (если требует) с тостом при сохранении.

### Пользовательская часть (`/u/:sub_token`)

Mobile-first, одна страница, без логина.

**Секции сверху вниз:**

1. **Header** — логотип/название + "Your VPN Subscription".
2. **QR-блок** — большой QR (300x300) + кнопка "Copy subscription link".
3. **UsageBar** — "Used 4.2 GB of 50 GB" + цветной прогресс.
4. **Expiry** — "12 days left" или "No expiry".
5. **ClientButtons** — 3-5 кнопок с deep links для ОС устройства:
   - iOS: Streisand, Shadowrocket, Karing
   - Android: v2rayNG, Hiddify, Karing
   - Desktop: Hiddify, sing-box
6. **InstructionsAccordion** — сворачиваемый блок "How to connect?" с step-by-step для каждой ОС со скриншотами.
7. **Advanced** (сворачиваемый) — три отдельных QR для VLESS / Hysteria 2, для продвинутых.

**Требования:**
- Время загрузки < 1.5s на 4G.
- Весь контент адаптивен для экранов от 320px.
- `<meta name="robots" content="noindex">` — чтобы не индексировалось.
- Темная тема по умолчанию (экономит батарею на OLED).
- Нет слов VLESS/Hysteria/Reality на основных секциях — только "VPN subscription".

### API клиент

```ts
// shared/api/client.ts
class ApiClient {
  private accessToken: string | null = null;
  
  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`/api${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(this.accessToken && { 'Authorization': `Bearer ${this.accessToken}` }),
        ...init?.headers,
      },
    });
    
    // автоматический refresh при 401
    if (res.status === 401 && this.accessToken) {
      const refreshed = await this.refresh();
      if (refreshed) {
        return this.request(path, init);  // повтор
      }
      throw new UnauthorizedError();
    }
    
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(body.error?.code, body.error?.message, res.status);
    }
    
    return res.json();
  }
}
```

### TanStack Query паттерны

**Ключи кэша — иерархические:**

```ts
export const usersKeys = {
  all: ['users'] as const,
  lists: () => [...usersKeys.all, 'list'] as const,
  list: (filters: Filters) => [...usersKeys.lists(), filters] as const,
  details: () => [...usersKeys.all, 'detail'] as const,
  detail: (id: string) => [...usersKeys.details(), id] as const,
  traffic: (id: string) => [...usersKeys.detail(id), 'traffic'] as const,
  links: (id: string) => [...usersKeys.detail(id), 'links'] as const,
};
```

**Оптимистичные апдейты для статуса:**

```ts
export function useToggleUserStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: UserStatus }) =>
      api.users.update(id, { status }),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: usersKeys.detail(id) });
      const prev = qc.getQueryData(usersKeys.detail(id));
      qc.setQueryData(usersKeys.detail(id), (old: User) => ({ ...old, status }));
      return { prev };
    },
    onError: (err, vars, ctx) => {
      qc.setQueryData(usersKeys.detail(vars.id), ctx?.prev);
      toast.error(humanizeError(err));
    },
    onSettled: (_, __, vars) => {
      qc.invalidateQueries({ queryKey: usersKeys.detail(vars.id) });
      qc.invalidateQueries({ queryKey: usersKeys.lists() });
    },
  });
}
```

### Code splitting

Monaco — отдельный чанк, lazy-loaded только на `/configs/*`:

```ts
const XrayEditor = lazy(() => import('@/features/configs/XrayEditor'));

<Route path="/configs/xray" element={
  <Suspense fallback={<EditorSkeleton />}>
    <XrayEditor />
  </Suspense>
} />
```

### Обработка ошибок

Централизованный словарь `humanizeError`:

```ts
const errorMessages: Record<string, string> = {
  user_already_exists:  'Пользователь с таким именем уже существует',
  user_not_found:       'Пользователь не найден',
  invalid_config:       'Конфигурация содержит ошибки',
  xray_unavailable:     'Сервис Xray не отвечает',
  hysteria_unavailable: 'Сервис Hysteria не отвечает',
  invalid_credentials:  'Неверное имя пользователя или пароль',
  rate_limit_exceeded:  'Слишком много попыток, подождите минуту',
};

export function humanizeError(err: unknown): string {
  if (err instanceof ApiError && err.code && errorMessages[err.code]) {
    return errorMessages[err.code];
  }
  return 'Что-то пошло не так. Попробуйте ещё раз';
}
```

Всё, что в лог — `console.error` и в Sentry (если подключен). Юзеру — только человеческий текст.

---

## 13. install.sh

### Общие требования

- Единый bash-скрипт в корне репозитория.
- Под-команды: `install`, `update`, `reinstall`, `uninstall`, `backup`, `restore`.
- Идемпотентен: повторный запуск `install` не ломает существующую установку.
- Не перезаписывает уже сгенерированные секреты в `.env`.
- Атомарные операции: все файлы пишутся в `.tmp` и потом `mv`.
- `set -euo pipefail` в начале.
- Цветной вывод с явными шагами `[1/10] Installing dependencies...`.
- Все ответы пользователя — в начале одним блоком.

### Порядок выполнения

```
1. Preflight checks
   - whoami == root
   - OS = Ubuntu 22.04/24.04 (cat /etc/os-release)
   - arch = x86_64 или aarch64
   - порты 80, 443/tcp, выбранный UDP свободны
   - свободно 1GB RAM, 5GB диска
   
2. Questions (все вместе, с дефолтами)
   - PANEL_DOMAIN
   - HY2_DOMAIN (default = PANEL_DOMAIN)
   - ACME_EMAIL
   - REALITY_SNI (с меню: cloudflare, microsoft, google, custom)
   - VLESS_PORT (default 443)
   - HY2_PORT (default 8443)
   - HY2_OBFS_ENABLED (default: yes)
   - PANEL_ADMIN_USERNAME (default: admin)
   - PANEL_ADMIN_PASSWORD (empty → autogen)
   
3. Install system dependencies
   apt install -y curl wget openssl jq uuid-runtime certbot \
     postgresql postgresql-contrib caddy
   
4. Install kernels via official scripts
   bash <(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh)
   bash <(curl -fsSL https://get.hy2.sh/)
   
5. Generate secrets (только если нет в .env)
   # Reality keys — ТОЛЬКО через xray
   KEYS=$(xray x25519)
   REALITY_PRIVATE_KEY=$(echo "$KEYS" | awk '/Private key:/ {print $3}')
   REALITY_PUBLIC_KEY=$(echo "$KEYS" | awk '/Public key:/ {print $3}')
   # Short IDs
   REALITY_SHORT_ID_1=""                    # пустой (опциональный)
   REALITY_SHORT_ID_2=$(openssl rand -hex 8)
   # Прочие
   HY2_OBFS_PASSWORD=$(openssl rand -base64 24)
   HY2_TRAFFIC_SECRET=$(openssl rand -hex 32)
   PANEL_JWT_SECRET=$(openssl rand -hex 64)
   DB_PASSWORD=$(openssl rand -hex 24)
   PANEL_ADMIN_PASSWORD=${PANEL_ADMIN_PASSWORD:-$(openssl rand -base64 18)}
   
6. Create system user and directories
   useradd -r -s /bin/false panel
   mkdir -p /opt/mypanel/{bin,configs/{xray,hysteria},templates,data/backups,logs}
   chown -R panel:panel /opt/mypanel
   
7. Setup PostgreSQL
   sudo -u postgres createuser panel
   sudo -u postgres createdb -O panel mypanel
   sudo -u postgres psql -c "ALTER USER panel WITH PASSWORD '$DB_PASSWORD';"
   
8. Get TLS cert for Hysteria
   certbot certonly --standalone --non-interactive --agree-tos \
     -m "$ACME_EMAIL" -d "$HY2_DOMAIN" \
     --pre-hook "systemctl stop caddy 2>/dev/null || true" \
     --post-hook "systemctl start caddy 2>/dev/null || true"
   # cron для обновления:
   echo "0 3 * * * certbot renew --quiet --post-hook 'systemctl reload hysteria'" > /etc/cron.d/certbot-hysteria
   
9. Download panel binary
   wget https://github.com/YOUR_USER/mypanel/releases/latest/download/panel-linux-amd64 \
     -O /opt/mypanel/bin/panel
   chmod +x /opt/mypanel/bin/panel
   chown panel:panel /opt/mypanel/bin/panel
   
10. Write .env atomically
    cat > /opt/mypanel/.env.tmp <<EOF
    PANEL_DOMAIN=$PANEL_DOMAIN
    ... (все переменные)
    EOF
    chmod 600 /opt/mypanel/.env.tmp
    chown panel:panel /opt/mypanel/.env.tmp
    mv /opt/mypanel/.env.tmp /opt/mypanel/.env
    
11. Render configs from templates
    /opt/mypanel/bin/panel config render --core=xray
    /opt/mypanel/bin/panel config render --core=hysteria
    
12. Install systemd units
    cp units/*.service /etc/systemd/system/
    systemctl daemon-reload
    
13. Install Caddyfile
    cat > /etc/caddy/Caddyfile <<EOF
    $PANEL_DOMAIN {
        reverse_proxy 127.0.0.1:8000
        @hy2auth path /hy2/auth
        respond @hy2auth 404
    }
    EOF
    systemctl reload caddy
    
14. Configure sudoers for panel user (systemctl)
    echo "panel ALL=(root) NOPASSWD: /bin/systemctl restart xray.service, /bin/systemctl restart hysteria.service, /bin/systemctl reload xray.service" > /etc/sudoers.d/panel
    chmod 440 /etc/sudoers.d/panel
    
15. DB migrations
    sudo -u panel /opt/mypanel/bin/panel migrate up
    
16. Create first admin
    sudo -u panel /opt/mypanel/bin/panel admin create \
      --username="$PANEL_ADMIN_USERNAME" --password="$PANEL_ADMIN_PASSWORD"
    
17. Start services
    systemctl enable --now xray hysteria panel
    
18. Final output
    echo "=========================================="
    echo "  Panel installed successfully!"
    echo "=========================================="
    echo "  URL:      https://$PANEL_DOMAIN"
    echo "  Username: $PANEL_ADMIN_USERNAME"
    echo "  Password: $PANEL_ADMIN_PASSWORD"
    echo "  (save this password — shown only once)"
    echo ""
    echo "  Logs:   journalctl -u panel -f"
    echo "  Config: nano /opt/mypanel/.env"
    echo "=========================================="
```

### Идемпотентность

Каждый шаг начинается с проверки "уже сделано?":

```bash
install_xray() {
    if [ -x /usr/local/bin/xray ]; then
        log "Xray already installed, skipping"
        return 0
    fi
    bash <(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh)
}

generate_reality_keys() {
    if grep -q "REALITY_PRIVATE_KEY=." /opt/mypanel/.env 2>/dev/null; then
        log "Reality keys already exist, skipping"
        return 0
    fi
    # генерация
}
```

### Uninstall

```bash
systemctl disable --now panel hysteria xray
rm -rf /opt/mypanel
rm /etc/systemd/system/{panel,xray,hysteria}.service
rm /etc/sudoers.d/panel
rm /etc/caddy/Caddyfile
sudo -u postgres dropdb mypanel
sudo -u postgres dropuser panel
userdel panel
systemctl daemon-reload
```

Не удаляем: сертификаты Let's Encrypt (могут пригодиться), пакеты (caddy, postgresql — могут использоваться чем-то ещё).

---

## 14. .env спецификация

```env
# === Panel ===
PANEL_DOMAIN=panel.example.com
PANEL_HOST=127.0.0.1
PANEL_PORT=8000
PANEL_JWT_SECRET=                    # autogen: openssl rand -hex 64
PANEL_JWT_ACCESS_TTL=15m
PANEL_JWT_REFRESH_TTL=720h
PANEL_LOG_LEVEL=info                 # debug|info|warn|error

# === Database ===
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=mypanel
DB_USER=panel
DB_PASSWORD=                         # autogen

# === Xray ===
XRAY_BINARY=/usr/local/bin/xray
XRAY_API_ADDR=127.0.0.1:10085
XRAY_CONFIG_PATH=/opt/mypanel/configs/xray/config.json
XRAY_INBOUND_TAG=vless-reality

VLESS_PORT=443
REALITY_DEST=www.cloudflare.com:443
REALITY_SNI=www.cloudflare.com
REALITY_PRIVATE_KEY=                 # autogen via xray x25519
REALITY_PUBLIC_KEY=                  # autogen (derived)
REALITY_SHORT_IDS=,a1b2c3d4e5f60718  # comma-separated, "" first = optional

# === Hysteria 2 ===
HY2_BINARY=/usr/local/bin/hysteria
HY2_CONFIG_PATH=/opt/mypanel/configs/hysteria/config.yaml
HY2_TRAFFIC_URL=http://127.0.0.1:7653
HY2_TRAFFIC_SECRET=                  # autogen

HY2_DOMAIN=panel.example.com
HY2_PORT=8443
HY2_OBFS_ENABLED=true
HY2_OBFS_PASSWORD=                   # autogen
HY2_BANDWIDTH_UP=1 gbps
HY2_BANDWIDTH_DOWN=1 gbps
HY2_MASQUERADE_URL=https://www.bing.com
HY2_CERT_PATH=/etc/letsencrypt/live/panel.example.com/fullchain.pem
HY2_KEY_PATH=/etc/letsencrypt/live/panel.example.com/privkey.pem

# === Subscription ===
SUB_URL_PREFIX=https://panel.example.com
SUB_UPDATE_INTERVAL_HOURS=24

# === Backup ===
BACKUP_DIR=/opt/mypanel/data/backups
BACKUP_RETENTION_DAYS=14
BACKUP_TIME_UTC=03:00
```

**Правила:**
- Секреты с пустым значением (`=$`) — автогенерируются install.sh.
- Секреты с заполненным — НЕ трогаются скриптом (идемпотентность).
- Runtime-настройки (SNI, bandwidth, порты) попадают в `settings` таблицу при первом старте и дальше редактируются через UI.
- `.env` — источник при первой установке, `settings` — источник в runtime.

---

## 15. Systemd юниты

### `/etc/systemd/system/xray.service`

Перезаписываем юнит от install-скрипта Xray:

```ini
[Unit]
Description=Xray Service
Documentation=https://github.com/xtls
After=network.target nss-lookup.target

[Service]
User=xray
CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_BIND_SERVICE
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ExecStart=/usr/local/bin/xray run -c /opt/mypanel/configs/xray/config.json
Restart=on-failure
RestartPreventExitStatus=23
LimitNPROC=10000
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
```

### `/etc/systemd/system/hysteria.service`

```ini
[Unit]
Description=Hysteria 2 Server
After=network.target

[Service]
User=hysteria
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
AmbientCapabilities=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ExecStart=/usr/local/bin/hysteria server -c /opt/mypanel/configs/hysteria/config.yaml
Restart=on-failure
RestartSec=5
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
```

### `/etc/systemd/system/panel.service`

```ini
[Unit]
Description=VPN Panel
After=network.target postgresql.service xray.service hysteria.service
Wants=postgresql.service

[Service]
Type=notify
User=panel
Group=panel
WorkingDirectory=/opt/mypanel
EnvironmentFile=/opt/mypanel/.env
ExecStart=/opt/mypanel/bin/panel serve
Restart=always
RestartSec=5
StartLimitInterval=60
StartLimitBurst=5

# Resource limits
LimitNOFILE=1048576
LimitNPROC=4096
TasksMax=4096

# Sandboxing
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/mypanel/data /opt/mypanel/configs /opt/mypanel/logs
PrivateTmp=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true

# Graceful shutdown
KillSignal=SIGTERM
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
```

`Type=notify` требует чтобы панель после старта слала `sd_notify(READY=1)` через `github.com/coreos/go-systemd/v22/daemon`.

---

## 16. Безопасность

### Аутентификация админов

- **Argon2id** для хеширования паролей. Параметры: `time=3, memory=64MB, threads=4`. Никогда bcrypt.
- **JWT access** короткий: 15 минут. В памяти фронта (в `useAuth` store, не в localStorage).
- **Refresh token** в httpOnly + Secure + SameSite=Strict cookie. 30 дней.
- **2FA TOTP** опционально (RFC 6238). Если включён — второй шаг после пароля.
- **Rate limit login**: 5 попыток/мин на IP. Дальше 429 и fail2ban лог.
- **Audit log** всех административных действий с IP и User-Agent.

### Защита webhook

- Слушает **только** 127.0.0.1. В коде хендлера дополнительно проверка `c.IP()`.
- В Caddy явный `respond @hy2auth 404` на путь `/hy2/auth`.
- Anti-flood: один токен не чаще 10 запросов/сек.

### Защита subscription

- Токен 32 случайных байта → ~256 бит энтропии.
- Rate limit `/sub/:token`: 60 req/min на IP.
- 404 без подсказок и с равномерным timing.
- `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`.
- Возможность ротации токена самим пользователем без входа в админку.

### CSP для фронта

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data:;
  connect-src 'self';
  frame-ancestors 'none';
```

### Защита от SQL injection

Только параметризованные запросы через pgx. Никаких `fmt.Sprintf` с данными в SQL. Всё через `$1, $2` биндинг.

### Защита от XSS

- React экранирует всё по умолчанию.
- `dangerouslySetInnerHTML` запрещён (ESLint rule).
- Сырой HTML от пользователя нигде не принимаем и не рендерим.

### Защита файловой системы

- `/opt/mypanel/.env` — 600, только `panel:panel`.
- `configs/` — 640, никто кроме panel и ядер.
- sudoers правило только для конкретных команд systemctl, не для всего.
- SELinux/AppArmor профиль (опционально, нативный sandboxing systemd уже закрывает большинство).

### Fail2ban интеграция

В `/etc/fail2ban/jail.d/panel.conf`:

```
[panel-auth]
enabled = true
filter = panel-auth
logpath = /var/log/caddy/access.log
findtime = 600
maxretry = 5
bantime = 3600
```

Filter matches `POST /api/auth/login 401`.

---

## 17. Стабильность и надёжность

### Инварианты, которые не должны нарушаться

1. **БД — источник истины.** Любое изменение идёт сначала в Postgres.
2. **Auth webhook P99 < 10ms.** БД в горячем пути запрещена.
3. **Reconciler работает всегда.** Не fallback, а основной механизм.
4. **Кэш переживает рестарт БД.** При недоступности БД старые записи продолжают работать.
5. **reset=true / clear=1 всегда при сборе трафика.** Иначе потеряем байты при рестарте ядер.
6. **Идемпотентность AddUser/RemoveUser.** AlreadyExists и NotFound — не ошибки.

### Граceful shutdown

При SIGTERM:

1. Перестать принимать новые HTTP запросы (`app.Shutdown(ctx)`).
2. Дождаться активных запросов (таймаут 20с).
3. Остановить scheduler.
4. Закрыть gRPC connection к Xray.
5. Закрыть pool PostgreSQL.
6. Завершиться с кодом 0.

Если не уложились в `TimeoutStopSec=30` — systemd шлёт SIGKILL.

### Startup sync

Панель не принимает запросов, пока:

1. БД доступна (`pgxpool.Ping`).
2. Миграции применены (`goose up`).
3. Xray gRPC отвечает (`xray.WaitReady(30s)`).
4. Hysteria Traffic API отвечает (`hysteria.Ping(30s)`).
5. Кэш пользователей заполнен (`cache.LoadAll`).
6. Reconciler выполнен один раз успешно.

Только после этого `sd_notify(READY=1)` и `app.Listen()`.

Если любой шаг не прошёл за таймаут — `os.Exit(1)`, systemd рестартнёт сервис.

### Retry политика

| Операция | Условие | Попытки | Backoff |
|----------|---------|---------|---------|
| Xray gRPC | `codes.Unavailable`, `DeadlineExceeded` | 3 | 100ms → 500ms → 2s |
| Hysteria HTTP | 5xx, timeout | 3 | 100ms → 500ms → 2s |
| DB transient | `40001` (serialization) | 3 | 10ms → 50ms → 200ms |
| Migration | любая | 1 | — (падаем, systemd рестартнёт) |

### Обработка ошибок gRPC

- `AlreadyExists` при AddUser → молча пропускаем.
- `NotFound` при RemoveUser → молча пропускаем.
- `Unavailable` → retry, потом warning в лог + надежда на reconciler.
- `DeadlineExceeded` → warning, операция могла пройти или нет — reconciler разберётся.
- Всё остальное → error в лог + возврат пользователю.

### Circuit breaker для ядер

Если 10 последовательных вызовов Xray провалились — открываем circuit breaker на 30 секунд. Все запросы в это время сразу возвращают "xray unavailable". Это предотвращает каскадный отказ когда Xray умер надолго.

### Кэш как защитный слой

Кэш для `/hy2/auth` обновляется:
- Синхронно при каждом Create/Update/Delete/StatusChange.
- Каждые 5 минут полной перезагрузкой (fallback).
- При startup — обязательная загрузка.

Если БД упала — webhook работает на последнем состоянии кэша. Новые юзеры в это время не могут подключиться, существующие — без перебоев.

### Рестарт ядер без потери пользователей

Поскольку `config.json` содержит `"clients": []`, после рестарта Xray пользователей в нём нет. Reconciler добавит всех в течение минуты. В промежутке активные клиенты отвалятся и должны переподключиться.

Это приемлемо для:
- Рестарта при обновлении Xray.
- Рестарта при применении нового config через UI.

Не приемлемо для:
- Просто добавления пользователя (для этого hot-add).
- Изменения trafic_limit пользователя (для этого просто UPDATE).

---

## 18. Мониторинг и observability

### `/healthz`

```json
GET /healthz

200 OK
{
  "status": "ok",
  "components": {
    "db": "ok",
    "xray": "ok",
    "hysteria": "ok",
    "cache": "ok"
  },
  "version": "1.0.0",
  "uptime_seconds": 86400
}

503 Service Unavailable
{
  "status": "degraded",
  "components": {
    "db": "ok",
    "xray": "fail: connection refused",
    "hysteria": "ok",
    "cache": "ok"
  }
}
```

### `/metrics` (Prometheus)

```
# Метрики панели
panel_users_total{status="active"} 142
panel_users_total{status="expired"} 23
panel_users_total{status="limited"} 5

# HTTP
http_requests_total{method="POST",path="/api/users",status="201"} 48
http_request_duration_seconds_bucket{path="/hy2/auth",le="0.01"} 10234
http_request_duration_seconds_bucket{path="/hy2/auth",le="0.05"} 10245
http_request_duration_seconds_bucket{path="/hy2/auth",le="0.1"} 10246

# Задачи
task_duration_seconds_bucket{task="collector",le="0.5"} 120
task_errors_total{task="reconciler"} 2

# Ядра
core_grpc_errors_total{code="Unavailable"} 0
core_http_errors_total{core="hysteria",status="500"} 0

# Webhook
hy2_auth_requests_total{result="ok"} 12345
hy2_auth_requests_total{result="denied"} 23

# Кэш
user_cache_size 142
user_cache_hits_total 54321
user_cache_misses_total 8
```

### Логирование

Structured JSON через `slog`:

```json
{"time":"2026-04-19T10:00:00Z","level":"INFO","msg":"user created","user_id":"...","admin_id":"...","request_id":"..."}
{"time":"2026-04-19T10:00:01Z","level":"WARN","msg":"xray stats failed","err":"context deadline exceeded","task":"collector"}
```

Вывод в stdout, systemd-journal автоматически подхватывает. Для просмотра:

```bash
journalctl -u panel -f
journalctl -u panel --since "10 minutes ago" | jq 'select(.level == "ERROR")'
```

### Alerting (опционально)

Если поднят Prometheus + Alertmanager — алерты:

- `panel_http_request_duration_seconds{path="/hy2/auth",quantile="0.99"} > 0.05` — webhook тормозит
- `rate(hy2_auth_requests_total{result="denied"}[5m]) > 10` — брутфорс или баг
- `panel_up == 0` — панель упала
- `core_grpc_errors_total` растёт — проблемы с Xray

---

## 19. Backup и восстановление

### Что бэкапим

1. **Дамп БД** — ежедневно через `pg_dump`, храним 14 дней.
2. **`.env`** — отдельно, вручную при изменении.
3. **Reality private key** — критичен, потеря = пересоздание всех юзеров.
4. **Сертификаты Let's Encrypt** — восстанавливаются автоматически, но бэкап ускоряет.

### Расположение

```
/opt/mypanel/data/backups/
├── panel-2026-04-19.sql.gz
├── panel-2026-04-18.sql.gz
└── ...
```

Критические файлы (env + reality key) рекомендуется копировать на внешнее хранилище (S3, rsync на другой сервер). Это задача админа, не панели.

### Восстановление на новом сервере

Команда из install.sh:

```bash
./install.sh restore --dump=/path/to/panel-2026-04-19.sql.gz --env=/path/to/.env
```

Алгоритм:
1. Prepare: установить зависимости, ядра, Caddy (как обычный install).
2. Восстановить `.env` из переданного файла.
3. Восстановить БД: `gunzip -c dump.sql.gz | psql -U panel mypanel`.
4. Рендер конфигов из БД.
5. Старт сервисов.
6. Reconciler сам всех пользователей добавит в Xray.

### Testing backup

Минимум раз в месяц разворачивать бэкап на тестовом VDS и проверять подключение клиентом. 90% бэкапов не работают — обнаруживается только когда нужно.

---

## 20. Roadmap разработки

### Фаза 1: Скелет бэкенда (неделя 1)

1. `go.mod`, структура папок.
2. `config/config.go` — парсинг .env.
3. `db/` — подключение, миграции, первичная схема.
4. `main.go` — стартует, подключается к БД, listenит на порту, отвечает на `/healthz`.
5. Makefile с `build`, `test`, `run`, `proto`.

**Критерий готовности:** `systemctl start panel` запускает сервис, `curl /healthz` возвращает 200.

### Фаза 2: Интеграция ядер (неделя 1-2)

6. `cores/xray/proto` — сгенерировать из .proto.
7. `cores/xray/client.go` — подключение, `WaitReady`, `AddUser`, `RemoveUser`, `QueryStats`, `ListUsers`. Покрыть тестами на замоканном gRPC.
8. `cores/hysteria/client.go` — `GetTraffic`, `Kick`.
9. `cores/hysteria/authhook.go` — handler.
10. Интеграционный тест: локально поднять Xray и Hysteria на тестовых портах, прогнать все операции.

**Критерий:** через code вызываются операции на живых ядрах.

### Фаза 3: Пользователи (неделя 2-3)

11. `domain/user.go` + `repo/users.go`.
12. `cache/users.go` — in-memory кэш.
13. `services/users.go` — Create/Update/Delete с координацией.
14. `api/handlers/users.go` — REST без auth.
15. `api/handlers/hyauth.go` — webhook.
16. E2E тест: создать юзера через API → подключить клиентом Hysteria 2 → успех.

**Критерий:** создание пользователя через POST `/api/users` → клиент подключается.

### Фаза 4: Subscription и VLESS (неделя 3)

17. `services/subscription.go` — генерация URI.
18. `api/handlers/sub.go` — endpoint.
19. Поддержка разных User-Agent (plain / clash / sing-box).
20. Проверка импорта в v2rayN, Hiddify, Streisand.

**Критерий:** клиент импортирует subscription, оба протокола работают.

### Фаза 5: Фоновые задачи (неделя 3-4)

21. `tasks/scheduler.go` с recover/mutex/timeout.
22. `tasks/collector.go` + batch запись.
23. `tasks/enforcer.go`.
24. `tasks/reconciler.go`.
25. `tasks/cache_refresh.go`.
26. Тесты: выставить лимит, прокачать трафик, убедиться что юзер отключён.

**Критерий:** превышение лимита автоматически блокирует пользователя, expiry тоже.

### Фаза 6: Админка и безопасность (неделя 4)

27. `repo/admins.go` + argon2id.
28. `services/auth.go` — JWT + refresh.
29. `api/middleware/jwt.go` + `ratelimit.go`.
30. `api/handlers/auth.go`.
31. TOTP поддержка.
32. Audit log.

**Критерий:** защищённый API, rate limiting работает.

### Фаза 7: Конфиги и settings (неделя 5)

33. `services/settings.go` — runtime настройки в БД.
34. `services/configs.go` — Render + Validate + Apply + History.
35. `cores/xray/config.go`, `cores/hysteria/config.go`.
36. `systemctl/systemctl.go`.
37. `api/handlers/configs.go`, `settings.go`.

**Критерий:** через API можно изменить SNI и bandwidth, ядра рестартуют, откат работает.

### Фаза 8: Observability (неделя 5)

38. Prometheus метрики.
39. `/healthz` с реальными проверками.
40. `/metrics`.
41. Structured logging по всему коду.
42. Тикер backup.

### Фаза 9: install.sh (неделя 6)

43. Preflight checks.
44. Установка зависимостей.
45. Генерация секретов.
46. Рендер конфигов и systemd.
47. Миграции и первый админ.
48. update / uninstall / restore команды.
49. Идемпотентность проверена многократно.

### Фаза 10: Фронтенд (недели 6-8)

50. Vite + React + Tailwind + shadcn setup.
51. `api/client.ts` с auto-refresh.
52. Login page + JWT flow.
53. Layout + routing + role guards.
54. Dashboard с заглушками.
55. UsersPage: таблица + создание + drawer.
56. SubscriptionPage (публичная).
57. ConfigEditor (Xray + Hysteria) с Monaco.
58. SettingsPage.
59. Реальные данные дашборда с графиками.
60. Audit page.
61. Polish: skeletons, empty states, анимации, краевые случаи.

### Фаза 11: Готовность к релизу (неделя 9)

62. Нагрузочный тест: 10000 юзеров в БД, 1000 RPS на webhook, проверка latency.
63. Тест восстановления из бэкапа на чистом VDS.
64. Документация пользователя: install, update, troubleshooting.
65. GitHub release с бинарниками (goreleaser).
66. Первая продакшн установка с мониторингом неделю.

**Итого:** ~9 недель для одного опытного разработчика на full-stack.

---

## 21. Типичные грабли

### Что НЕ делать

1. **Не хешировать `hy2_password`.** Это не пароль юзера, это ключ для identify. Хеш нельзя передать в подписку.

2. **Не использовать SIGHUP для рестарта ядер.** Xray и Hysteria не умеют. Только `systemctl restart`, и только по явному пути рестарта.

3. **Не делать сложную логику в bash install.sh.** Парсинг JSON, условная логика — переносите в `panel` бинарник через CLI subcommands (`panel config render`, `panel admin create`).

4. **Не генерировать Reality ключи через openssl.** Только `xray x25519` — он делает необходимую коррекцию private key. Иначе public не будет соответствовать.

5. **Не хранить access JWT в localStorage.** XSS украдёт за секунду. Только memory + httpOnly cookie для refresh.

6. **Не использовать один JWT secret global.** При ротации приходится разлогинивать всех. Используйте `kid` в header + таблицу ключей.

7. **Не делать `timestamp` без `tz` в БД.** Через месяц получите баг "подписка истекла на час раньше". Всегда `timestamptz` в UTC.

8. **Не писать в stderr и stdout одновременно разные вещи.** systemd смешивает. JSON через slog в stdout — единственно правильно.

9. **Не игнорировать systemd `Type=notify`.** Без него systemd не знает, что панель готова, и `depends_on` не работает корректно.

10. **Не забыть про кросс-компиляцию в Makefile.**

```make
build-linux-amd64:
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
        -ldflags "-s -w -X main.Version=$(VERSION)" \
        -o dist/panel-linux-amd64 ./cmd/panel
```

11. **Не запускать панель от root.** Системный пользователь `panel`, sudoers только на конкретные systemctl команды.

12. **Не путать панель с прокси.** Панель НЕ обслуживает клиентский VPN-трафик. Клиенты ходят напрямую в Xray:443 и Hysteria:8443. Панель только управляет.

### Частые баги

- **"Юзер создан, но Hysteria не пускает"** — кэш не обновился. Проверить invalidation в `UserService.Create`.
- **"Счётчики прыгают"** — забыли `reset=true` / `clear=1`, получаете абсолютные значения вместо дельт.
- **"Reality хендшейк падает"** — `serverName` в конфиге не совпадает с сертификатом `dest` сайта. Проверить `curl -v https://<dest>` и увидеть реальный SNI.
- **"Hysteria не стартует после изменения cert"** — certbot поменял файлы, Hysteria надо перезагрузить. Cron post-hook обязателен.
- **"Подписка не импортируется в клиент"** — лишний параметр в URI или неправильный порядок. Сверить с каноническим форматом.
- **"Админка тормозит на списке 10000 юзеров"** — не виртуализировали таблицу. `tanstack-virtual`.
- **"P99 webhook 200ms"** — кто-то ходит в БД в горячем пути. Проверить, что только кэш.

### Эксплуатационные

- **Место на диске.** `traffic_log` без ротации разрастётся. Чистить строки старше 30 дней.
- **Ротация логов.** systemd-journal по дефолту хранит лимитом. Настройте `SystemMaxUse=1G` в `/etc/systemd/journald.conf`.
- **Обновление ядер.** Xray и Hysteria выпускаются часто. `panel update` (команда install.sh) должна обновлять бинарники и рестартить.
- **Обновление Reality SNI.** Когда выбранный `dest`-сайт меняет политики (отключает TLS 1.3, редиректит) — Reality перестаёт работать. Держите 2-3 альтернативных SNI на выбор.

---

## Итог

Это вся система в одном документе. Бэкенд — единый статический Go-бинарник (~30 МБ). Три процесса на VDS (xray, hysteria, panel). PostgreSQL как единый источник истины. Reconciler как основной механизм синхронизации. Webhook с кэшем для мгновенной авторизации Hysteria. Фронтенд — SPA на React + Monaco с двумя интерфейсами (админ и пользователь).

Для агента, который будет это реализовывать: иди строго по фазам roadmap. Не забегай вперёд — каждая фаза должна полностью работать перед следующей. После Фазы 5 у тебя работающий бэкенд без UI, которым можно пользоваться через curl. После Фазы 10 — production-ready продукт.

