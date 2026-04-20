# VPN Panel — Design System

> Визуальная спецификация к SPEC.md. Всё, что нужно для пиксель-перфектной реализации фронтенда: шрифты, цвета, блоки, компоненты, иконки, паттерны.

---

## Оглавление

1. [Дизайн-философия](#1-дизайн-философия)
2. [Типографика](#2-типографика)
3. [Цветовая система](#3-цветовая-система)
4. [Shadcn blocks (готовые)](#4-shadcn-blocks-готовые)
5. [Shadcn components (полный список)](#5-shadcn-components-полный-список)
6. [Иконки Lucide](#6-иконки-lucide)
7. [Spacing и сетка](#7-spacing-и-сетка)
8. [Motion (анимации)](#8-motion-анимации)
9. [Компонентные паттерны](#9-компонентные-паттерны)
10. [Страницы админки](#10-страницы-админки)
11. [Страница подписки](#11-страница-подписки)
12. [Empty states, loading, errors](#12-empty-states-loading-errors)
13. [Адаптивность](#13-адаптивность)
14. [tailwind.config и global.css](#14-tailwindconfig-и-globalcss)

---

## 1. Дизайн-философия

### Направление

**Refined technical minimalism.** Чёрная база, одна ядовито-яркая акцентная точка, монотипографика для всего технического, засечный серифный дисплейный шрифт для акцентов на пользовательской странице. Без закруглений ради закруглений, без градиентных плашек, без стоковых иконок размером с кнопку.

Ориентиры по духу: Linear dashboard × Arc browser × ProtonVPN, но с собственным характером через акцентный цвет и типографическую пару.

### Два контекста, два настроения

- **Админка** — dense, технично, только dark mode. Много данных в таблицах, монотипографика для всего, что «ключ/токен/URI», generous padding внутри карточек, тонкие 1px бордеры, minimal shadows. Ощущение: «профессиональный инструмент».
- **Страница подписки пользователя** — воздушно, крупный шрифт, серифный акцент, больше воздуха, можно и светлую и тёмную тему (опционально — по системе). Ощущение: «продукт, а не админка».

### Правила без исключений

- **Никакого Inter, Roboto, Arial, system-ui** в дизайне.
- **Никаких фиолетовых градиентов**. Акцент один — electric lime.
- **Никаких round-full кнопок как primary action.** Кнопки прямоугольные с `rounded-md` (6px).
- **Никаких drop-shadow поверх drop-shadow.** Тени — редкие, функциональные.
- **Никаких decorative emoji в UI.** Только Lucide иконки.
- **Все секреты, UUID, URI — только JetBrains Mono.** Всегда.

---

## 2. Типографика

### Шрифты

| Роль | Шрифт | Источник | Применение |
|------|-------|----------|------------|
| **Sans** (UI) | **Geist Sans** | Vercel fonts / Google Fonts | Весь админский UI: кнопки, меню, таблицы, формы |
| **Serif** (display) | **Instrument Serif** | Google Fonts | Заголовки на пользовательской странице подписки |
| **Mono** | **JetBrains Mono** | Google Fonts | UUID, токены, URI, конфиги, секреты, коды ошибок |

Подключение в `index.html`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" crossorigin />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500;600&display=swap"
  rel="stylesheet"
/>
```

Через CSS variables:

```css
:root {
  --font-sans: "Geist", ui-sans-serif, system-ui, sans-serif;
  --font-serif: "Instrument Serif", ui-serif, Georgia, serif;
  --font-mono: "JetBrains Mono", ui-monospace, "SF Mono", monospace;
}
```

### Шкала размеров

Используем Tailwind шкалу с уточнениями:

| Класс | Размер | Line-height | Применение |
|-------|--------|-------------|------------|
| `text-xs` | 11px | 16px | Labels, badges, table column headers, captions |
| `text-sm` | 13px | 20px | Базовый body для админки, форм, таблиц |
| `text-base` | 14px | 22px | Крупнее body (в UserDrawer, модалках) |
| `text-lg` | 16px | 24px | Заголовки карточек |
| `text-xl` | 18px | 28px | H3 в настройках |
| `text-2xl` | 22px | 30px | H2 (секции страниц) |
| `text-3xl` | 28px | 36px | H1 админских страниц |
| `text-5xl` | 48px | 56px | H1 на пользовательской странице (serif) |
| `text-7xl` | 72px | 80px | Hero «MyVPN» на странице подписки (serif) |

Админка работает на `text-sm` по дефолту (13px). Это плотнее чем 14-15px Bootstrap-стиля и даёт больше инфы на экране.

### Веса

- **400 Regular** — весь body текст.
- **500 Medium** — labels, секции.
- **600 Semibold** — заголовки, кнопки, primary-текст в метриках.
- **700 Bold** — только очень редко, для «огромных чисел» в дашборде.

Никаких `font-light` / `font-thin` — плохо читаются на мониторах.

### Typographic tokens

```css
/* админка */
.t-metric    { font: 600 28px/1.1 var(--font-sans); letter-spacing: -0.02em; }
.t-h1        { font: 600 24px/1.2 var(--font-sans); letter-spacing: -0.01em; }
.t-h2        { font: 600 18px/1.3 var(--font-sans); letter-spacing: -0.005em; }
.t-label     { font: 500 11px/1.4 var(--font-sans); letter-spacing: 0.06em; text-transform: uppercase; }
.t-body      { font: 400 13px/1.5 var(--font-sans); }
.t-code      { font: 400 12px/1.5 var(--font-mono); letter-spacing: -0.01em; }

/* пользовательская */
.t-hero      { font: 400 72px/0.95 var(--font-serif); letter-spacing: -0.02em; }
.t-display   { font: 400 48px/1.05 var(--font-serif); letter-spacing: -0.015em; }
.t-sublead   { font: 400 18px/1.55 var(--font-sans); color: var(--muted-foreground); }
```

`.t-label` — всегда UPPERCASE + tracking 6%. Это единственный случай uppercase. Придаёт «инженерный» вид лейблам.

Serif в заголовках пользовательской страницы — единственный «красивый» жест в продукте. Намеренный контраст с функциональной админкой.

---

## 3. Цветовая система

### Палитра (dark mode — default)

Все цвета через HSL для плавных манипуляций прозрачностью.

```css
:root {
  /* Базовые поверхности */
  --background:       220 12% 5%;      /* #0B0C0E — основа, почти чёрный с холодком */
  --surface:          220 10% 8%;      /* #131417 — карточки */
  --surface-elevated: 220 9% 11%;      /* #1B1C20 — поповеры, dropdown, tooltip */
  --surface-sunken:   220 14% 3%;      /* #07080A — inputs, code-блоки */

  /* Бордеры */
  --border:           220 8% 16%;      /* #25272C — базовый */
  --border-strong:    220 7% 22%;      /* #34363C — при hover, focus-visible */

  /* Текст */
  --foreground:       210 17% 96%;     /* #F2F4F7 — primary */
  --muted-foreground: 220 6% 62%;      /* #979AA2 — secondary */
  --faint-foreground: 220 5% 42%;      /* #63666D — hints, placeholders */

  /* Акцент — electric lime */
  --primary:          74 100% 60%;     /* #C4F533 — действия, фокус, активное */
  --primary-foreground: 220 14% 6%;    /* тёмный текст на lime */
  --primary-glow:     74 100% 60% / 0.22;   /* для subtle box-shadow */

  /* Вторичный акцент — teal (редкий, для «успех» и online) */
  --success:          165 90% 50%;     /* #0FE8B8 */
  --success-foreground: 220 14% 6%;

  /* Статусные */
  --destructive:      0 84% 62%;       /* #EF4444 — warm red */
  --destructive-foreground: 210 17% 96%;
  --warning:          38 95% 55%;      /* #F7A11A — amber */
  --warning-foreground: 220 14% 6%;
  --info:             210 90% 60%;     /* #3D8AF2 — используется редко */

  /* Интерактивные состояния */
  --hover-overlay:    210 17% 96% / 0.04;    /* едва видимая подсветка */
  --active-overlay:   210 17% 96% / 0.08;
  --ring:             74 100% 60% / 0.45;    /* focus-visible */

  /* Графики */
  --chart-1: 74 100% 60%;    /* lime */
  --chart-2: 165 90% 50%;    /* teal */
  --chart-3: 38 95% 55%;     /* amber */
  --chart-4: 210 90% 60%;    /* blue */
  --chart-5: 280 70% 70%;    /* subtle purple — только когда нужно 5 серий */
}
```

### Палитра (light mode — только для пользовательской страницы)

```css
[data-theme="light"] {
  --background:       45 25% 97%;      /* #FAF8F4 — тёплый off-white */
  --surface:          0 0% 100%;
  --surface-elevated: 0 0% 100%;
  --surface-sunken:   45 20% 94%;
  --border:           40 10% 88%;
  --border-strong:    40 8% 76%;
  --foreground:       220 14% 8%;
  --muted-foreground: 220 6% 42%;
  --primary:          74 85% 42%;      /* приглушённый lime на свету */
  --primary-foreground: 0 0% 100%;
  --destructive:      0 72% 48%;
  --success:          165 70% 35%;
}
```

Админка **только** dark. Светлая тема не нужна. Пользовательская страница — свитч `prefers-color-scheme`.

### Правила использования цвета

- **80% экрана** — `background` + `surface`. Базовая тёмная среда.
- **15%** — `foreground` + `muted-foreground` (текст).
- **4%** — `border`, разделители.
- **1%** — **акцент** (`primary`). Используется точечно: hover-состояния кнопок-действий, активный пункт сайдбара, фокус input, прогресс-бар трафика, точка «online».

Чем меньше акцента — тем сильнее он работает. Плашки «Save», «Create» — не lime фоном, а `surface-elevated` + lime бордер/текст. Lime-фон только на **одной** главной CTA на странице (например, `Apply` в редакторе конфига).

### Семантика статусов

| Статус юзера | Цвет | Применение |
|-------------|------|------------|
| `active` | `success` | Точка в Badge, borderless |
| `disabled` | `muted-foreground` | Badge outline |
| `expired` | `warning` | Badge outline |
| `limited` | `destructive` | Badge outline |

Status dots — 6px круг, при `active` пульсирует через `@keyframes pulse-ring`.

---

## 4. Shadcn blocks (готовые)

Shadcn имеет официальные blocks по адресу `ui.shadcn.com/blocks`. Берём их как стартовые точки и адаптируем под нашу палитру и шрифты.

| Блок shadcn | Где используется | Адаптация |
|-------------|------------------|-----------|
| **sidebar-07** или **sidebar-08** | Основной layout админки (collapsible sidebar + main area) | Заменить primary цвет на lime, иконки — Lucide из нашего набора, логотип — custom |
| **dashboard-01** | Структура DashboardPage (grid карточек + chart + table) | Использовать Recharts area chart с lime-градиентом, карточки упростить |
| **login-03** | LoginPage | Убрать social providers, только username/password + TOTP поле |
| **login-04** | Альтернатива для LoginPage (split с картинкой) | На правой панели — большой serif-лого и цитата |
| **authentication-01** | Recovery flows (reset password) — для v2 | — |

### Custom-blocks (собираем сами)

Эти блоки shadcn не даёт — собираем из компонентов:

- **UserDrawer** — Sheet справа шириной 560px с внутренними Tabs (Details / Links / Traffic).
- **ConfigEditor** — полноэкранная область с Monaco + верхняя toolbar (Validate / Apply / History) + diff-dialog.
- **UserLinksPanel** — 3 карточки подряд (Subscription / VLESS / Hysteria 2) с QR и copy-действиями.
- **SubscriptionPage** — центрированный layout 480px max-width, QR + прогресс + кнопки клиентов.

---

## 5. Shadcn components (полный список)

Устанавливаем через CLI. Группирую по приоритету.

### Критичные (ставим первыми)

```bash
npx shadcn@latest add button badge card input label form \
  table dropdown-menu dialog sheet drawer tabs separator \
  skeleton sonner alert alert-dialog tooltip sidebar
```

| Компонент | Ключевое применение |
|-----------|---------------------|
| `button` | Все действия. Варианты: default, secondary, outline, ghost, destructive, link |
| `badge` | Статусы юзеров (dot + text), теги, метки версий в history |
| `card` | Везде. Обязательно через `<Card><CardHeader><CardContent></Card>` |
| `input` | Формы, поиск в таблицах |
| `label` | Парный с Input, всегда. `t-label` стиль |
| `form` | React Hook Form + Zod обёртки, для CreateUserDialog и Settings |
| `table` | UsersPage, AuditPage, ConfigHistoryDialog |
| `dropdown-menu` | Контекстные меню на строках таблицы, user avatar, config history |
| `dialog` | CreateUserDialog, ConfirmDeleteUser, DiffDialog, сброс sub_token |
| `sheet` | UserDrawer (right, 560px), Settings panels в мобиле |
| `drawer` | На мобильном вместо Sheet (bottom sheet via vaul) |
| `tabs` | Внутри UserDrawer, SettingsPage, ConfigsPage (Xray / Hysteria) |
| `separator` | Разделители внутри Cards и меню |
| `skeleton` | Все loading-состояния |
| `sonner` | Тосты (успех/ошибка при мутациях) |
| `alert` | Inline warnings, например в DiffDialog «перезапустит ядро» |
| `alert-dialog` | Destructive confirmations: удаление юзера, откат конфига |
| `tooltip` | Hover-подсказки на иконках, read-only полях конфига, truncated значениях |
| `sidebar` | Навигация админки (из sidebar-07) |

### Вторичные

```bash
npx shadcn@latest add select switch checkbox textarea \
  progress popover command hover-card avatar breadcrumb \
  pagination collapsible accordion scroll-area chart \
  navigation-menu toggle toggle-group radio-group calendar \
  date-picker number-input
```

| Компонент | Ключевое применение |
|-----------|---------------------|
| `select` | Выбор фильтра статуса, core в history, роли админа |
| `switch` | Toggle полей в Settings (obfs enabled, 2FA) |
| `checkbox` | Массовый выбор в таблице юзеров |
| `textarea` | Поле note, audit-диалог |
| `progress` | Прогресс-бар трафика юзера (кастомизированный с lime fill) |
| `popover` | Фильтры таблицы (faceted filter), popover с full value для truncated |
| `command` | Global search (Cmd+K): переход к юзеру, странице, настройке |
| `hover-card` | Preview юзера при hover на username в audit log |
| `avatar` | Аватары админов (инициалы на surface-elevated, без картинок) |
| `breadcrumb` | В глубоких разделах: Settings > Admins > Edit |
| `pagination` | Таблицы юзеров и audit (если > 50 строк) |
| `collapsible` | «Advanced» секция в SubscriptionPage |
| `accordion` | «How to connect?» на SubscriptionPage |
| `scroll-area` | Внутри Sheet, кастомный scrollbar (тонкий, lime на hover) |
| `chart` | Recharts wrapper из shadcn. Traffic chart, user growth chart |
| `navigation-menu` | Top-bar в layout (с user menu справа) |
| `toggle` / `toggle-group` | Time range selector в дашборде (1D / 7D / 30D) |
| `radio-group` | Выбор theme в Settings (system/dark/light) |
| `calendar` + `date-picker` | Expires_at в CreateUserDialog |
| `number-input` | Traffic limit, порты |

### Third-party (через npm, не shadcn CLI)

| Пакет | Назначение |
|-------|------------|
| `@monaco-editor/react` | Редактор конфигов |
| `recharts` | Графики (обёрнут в shadcn `chart`) |
| `sonner` | Тосты (уже включено в shadcn add) |
| `vaul` | Drawer на мобильном (входит в shadcn drawer) |
| `@tanstack/react-virtual` | Виртуализация таблицы юзеров (> 200 строк) |
| `qrcode.react` | Клиентский fallback QR (основное — с бэка) |
| `@tanstack/react-table` | Table с фильтрами/сортировкой (обёрнут в shadcn) |

### Кастомные компоненты поверх shadcn

Эти пишем сами, расширяя shadcn-примитивы:

- **`<StatusBadge status>`** — Badge с цветной точкой (pulse для active).
- **`<TrafficBar used total>`** — Progress кастомный с цветовой шкалой (lime → amber → destructive при приближении к лимиту).
- **`<CopyButton value>`** — IconButton (Copy → Check на 2 секунды после клика).
- **`<MonoField value>`** — inline-блок с моно-шрифтом, рамкой и `<CopyButton>`.
- **`<QRCard value label>`** — Card с QR по центру и подписью, кнопка Copy снизу.
- **`<MetricCard label value delta icon>`** — карточки дашборда.
- **`<DurationBadge expires>`** — Badge «12d left», warning при < 3 дней, destructive при 0.
- **`<KernelStatusIndicator core>`** — точка + текст «Xray running / Xray error» для статуса ядер.
- **`<PasswordField>`** — Input с глазом toggle visibility.
- **`<PresetChips options selected onChange>`** — горизонтальный ряд чипов-пресетов (для traffic limit, expires).

---

## 6. Иконки Lucide

**Единственная библиотека иконок.** Размер по умолчанию 16px (`h-4 w-4`), для кнопок — 14px, для крупных акцентов — 20px. Stroke width 1.75 (немного тоньше дефолтного 2).

### Карта: где какая иконка

**Sidebar navigation:**
- Dashboard → `LayoutDashboard`
- Users → `Users`
- Configs → `FileCode2`
- Settings → `Settings2`
- Audit → `ScrollText`
- Logs (отдельная страница если нужно) → `Terminal`

**User actions:**
- Create → `UserPlus`
- Edit → `Pencil`
- Delete → `Trash2`
- Disable → `Ban`
- Enable → `CheckCircle2`
- Reset traffic → `RotateCcw`
- Reset token → `RefreshCw`
- Copy → `Copy` (после клика → `Check` 2 секунды)
- QR code → `QrCode`
- Extend expiry → `CalendarPlus`

**Status:**
- Active → `Circle` (заливка lime)
- Disabled → `Circle` (заливка muted)
- Expired → `Clock`
- Limited → `Gauge` (с заполнением)
- Online → `Zap` (пульсирует lime)

**Navigation и UI:**
- Search → `Search`
- Filter → `SlidersHorizontal`
- Sort → `ArrowUpDown`
- More (row menu) → `MoreHorizontal`
- External link → `ExternalLink`
- Chevron → `ChevronRight` / `ChevronDown`
- Back → `ArrowLeft`
- Close → `X`
- Expand → `Maximize2`
- Fullscreen → `Expand`

**Configs и files:**
- Config editor → `FileJson2` (Xray), `FileText` (Hysteria YAML)
- Validate → `CircleCheck`
- Apply → `PlayCircle`
- History → `History`
- Restore version → `Undo2`
- Download → `Download`
- Upload → `Upload`
- Diff view → `GitCompare`

**System и ядра:**
- Xray → `Shield` (protocol)
- Hysteria → `Zap` (fast)
- Server/VDS → `Server`
- Database → `Database`
- Restart → `RotateCw`
- Healthy → `Activity`
- Error → `AlertCircle`
- Warning → `AlertTriangle`

**Auth и безопасность:**
- Login → `LogIn`
- Logout → `LogOut`
- Lock → `Lock`
- Unlock → `Unlock`
- Eye (show password) → `Eye`
- EyeOff → `EyeOff`
- 2FA → `ShieldCheck`
- Key → `Key`

**Traffic и метрики:**
- Upload → `ArrowUp`
- Download → `ArrowDown`
- Speed → `Gauge`
- Bandwidth → `Activity`
- Chart line → `LineChart`
- Chart area → `AreaChart`
- Trending up → `TrendingUp`
- Trending down → `TrendingDown`

**Subscription page (user-facing):**
- VPN/Shield → `ShieldCheck` (hero)
- QR → `QrCode`
- Copy link → `Link2`
- Install guide → `BookOpen`
- iOS → `Smartphone`
- Android → `Smartphone`
- Desktop → `Monitor`
- Apple/iOS Streisand → `AppWindow` (или `Smartphone`)
- Reset sub → `RefreshCw`

### Правила использования

- **Никогда не смешивать стили иконок.** Только Lucide outline. Никаких filled иконок из других наборов.
- **Кнопки с иконками**: иконка слева, текст справа, gap 8px (`gap-2`).
- **Icon-only кнопки** — обязательный `<Tooltip>` с описанием действия.
- **Размер в кнопках**: в `size="sm"` кнопке иконка 14px, в `size="default"` — 16px.
- **Не использовать emoji**. Никогда. Даже в empty states.

---

## 7. Spacing и сетка

### Tailwind spacing scale

Используем стандартную Tailwind шкалу без кастомизаций:
`0 / 1 (4px) / 2 (8px) / 3 (12px) / 4 (16px) / 5 (20px) / 6 (24px) / 8 (32px) / 10 (40px) / 12 (48px) / 16 (64px) / 20 (80px) / 24 (96px)`

### Базовые правила

- **Padding внутри Card**: `p-6` (24px) по бокам, `py-5` для компактных.
- **Gap между Cards**: `gap-4` (16px) в grid, `gap-6` для крупных секций.
- **Padding внутри Button**: `sm` — `px-3 h-8`, `default` — `px-4 h-9`, `lg` — `px-6 h-10`. Все кнопки одной страницы — одного размера.
- **Form field gap**: `space-y-2` между Label и Input, `space-y-4` между полями.
- **Section padding**: страницы админки — `p-6 lg:p-8`.
- **Container max-width**: админка `max-w-[1600px]`, subscription — `max-w-[480px]`.

### Layout админки (desktop)

```
┌────────────────────────────────────────────────────────────┐
│  Sidebar 240px  │  Main area (fluid, max-w-1600)          │
│  (collapsible   │  ┌─────────────────────────────────────┐ │
│   to 64px)      │  │  Top bar 56px                       │ │
│                 │  ├─────────────────────────────────────┤ │
│                 │  │  Page content                       │ │
│                 │  │  padding: 24px / 32px lg             │ │
│                 │  │                                      │ │
│                 │  └─────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

Sidebar collapsed (64px) показывает только иконки + всплывающий tooltip. Состояние сохраняется в localStorage.

### Grid для дашборда

```
┌──── overview cards ────┐
│  [1] [2] [3] [4]       │  grid-cols-4 gap-4 (lg), grid-cols-2 (md), grid-cols-1 (sm)
├────────────────────────┤
│  [ traffic chart    ]  │  col-span-2 lg:col-span-3
│  [ online users     ]  │  col-span-1
├────────────────────────┤
│  [ kernel status    ]  │  col-span-2
│  [ recent activity  ]  │  col-span-2
└────────────────────────┘
```

### Breakpoints

| Breakpoint | Ширина | Применение |
|------------|--------|------------|
| `sm` | 640px | Mobile landscape / small tablet |
| `md` | 768px | Tablet |
| `lg` | 1024px | Desktop — основной target |
| `xl` | 1280px | Wide desktop |
| `2xl` | 1536px | Ultra-wide |

Админка начинается с `md` (mobile только read-only). SubscriptionPage — full mobile-first.

---

## 8. Motion (анимации)

### Принципы

1. **Быстро и незаметно в UI действиях.** Hover 150ms, click 100ms.
2. **Entrance и exit — 200/150ms ease-out.** Dialog, Sheet, Drawer.
3. **Никаких bounce, spring, elastic.** Только `ease-out`, `cubic-bezier(0.16, 1, 0.3, 1)` для чуть более «expressive».
4. **Stagger для списков — только один раз при первой загрузке.** Не на каждое обновление.
5. **Reduce motion.** Обязательно `@media (prefers-reduced-motion: reduce)` с отключением всего кроме фейдов.

### Токены

```css
:root {
  --ease-out:    cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --duration-fast:   100ms;
  --duration-base:   150ms;
  --duration-slow:   200ms;
  --duration-slower: 300ms;
}
```

### Каталог микро-анимаций

| Элемент | Анимация |
|---------|----------|
| Button hover | `transition: background 100ms ease-out, transform 100ms` + `active:scale-[0.98]` |
| Card hover (кликабельная) | `transition: border-color 150ms, background 150ms` + border → `border-strong` |
| Dialog enter | `fade-in 150ms + scale from 0.96 to 1 150ms ease-out` |
| Sheet enter | `slide-in from right 200ms ease-out` |
| Drawer (mobile) | `slide-in from bottom 250ms ease-out` |
| Tooltip | delay 500ms, fade 100ms |
| Skeleton | `pulse 1.5s ease-in-out infinite` |
| Status dot (active) | `pulse-ring 2s ease-out infinite` — expanding ring 0→150% with opacity 0.5→0 |
| Toast (sonner) | из коробки sonner, принимаем defaults |
| Copy button → Check | swap icons, scale `from 0.5 to 1` 150ms, hold 2s, fade обратно |
| Route transition | `fade 100ms` (без slide — чтоб не отвлекало) |
| Online dot | `glow-pulse 1.8s` — box-shadow 0 0 0→8px lime fade out |

### Кастомные keyframes

```css
@keyframes pulse-ring {
  0%   { box-shadow: 0 0 0 0 hsl(var(--success) / 0.6); }
  70%  { box-shadow: 0 0 0 6px hsl(var(--success) / 0); }
  100% { box-shadow: 0 0 0 0 hsl(var(--success) / 0); }
}

@keyframes glow-pulse {
  0%, 100% { box-shadow: 0 0 0 0 hsl(var(--primary) / 0); }
  50%      { box-shadow: 0 0 8px 2px hsl(var(--primary) / 0.35); }
}

@keyframes skeleton-shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
```

---

## 9. Компонентные паттерны

### Card (базовый)

```tsx
<Card className="border-border bg-surface">
  <CardHeader className="pb-4">
    <CardTitle className="text-base font-semibold">Title</CardTitle>
    <CardDescription className="text-xs text-muted-foreground">
      Subtitle
    </CardDescription>
  </CardHeader>
  <CardContent>
    {/* content */}
  </CardContent>
</Card>
```

- Border 1px `--border`.
- Background `--surface`.
- Padding `p-6`, header `pb-4`.
- Без shadow по дефолту.
- Hover (если clickable) — border → `--border-strong` + `bg-hover-overlay`.

### MetricCard

```
┌─────────────────────────────┐
│ [icon 16px]  ACTIVE USERS   │  ← label uppercase 11px muted
│                             │
│  142                        │  ← metric 28px semibold
│                             │
│  ↑ 8 from yesterday         │  ← delta text-xs with trend icon
└─────────────────────────────┘
```

- Icon в top-left, `muted-foreground`.
- Delta positive — `text-success`, negative — `text-destructive`.

### StatusBadge

```tsx
<Badge variant="outline" className="gap-1.5">
  <span className="relative flex h-1.5 w-1.5">
    <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-75 animate-pulse-ring" />
    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
  </span>
  Active
</Badge>
```

- Для `active` — с pulse-ring.
- Для остальных — статичная точка.

### Table (таблица юзеров)

```
┌──────────────────────────────────────────────────────────────┐
│ □ │ USERNAME  │ STATUS  │ TRAFFIC      │ EXPIRES │ CREATED │…│
├──────────────────────────────────────────────────────────────┤
│ □ │ alice     │ ● Active│ ▓▓▓░░ 24%    │ 12d     │ Apr 3   │⋯│
│ □ │ bob       │ ◌ Off   │ ▓▓▓▓▓ 98%!   │ —       │ Mar 15  │⋯│
└──────────────────────────────────────────────────────────────┘
```

- Row height 52px.
- `cursor-pointer` + hover `bg-hover-overlay`.
- Click → UserDrawer.
- Кнопка `⋯` → `DropdownMenu` (Edit, Reset traffic, Reset token, Delete).
- Selected rows — leading border lime 2px + `bg-active-overlay`.

### UserDrawer (Sheet right, 560px)

```
┌──────────────────────────────────┐
│  alice          [⋯]  [×]         │  ← header
│  ● Active · Created Apr 3         │
├──────────────────────────────────┤
│  [Details] [Links] [Traffic]     │  ← Tabs
├──────────────────────────────────┤
│                                  │
│  (tab content)                   │
│                                  │
└──────────────────────────────────┘
```

- Header: username (text-xl semibold) + status row below.
- Кнопка `⋯` для действий (Disable, Reset..., Delete).
- Tabs sticky под header при скролле.

### UserLinksPanel (вкладка Links)

Три Card друг под другом:

```
┌──────────────────────────────────┐
│  SUBSCRIPTION                    │  ← label uppercase
│                                  │
│  ┌────────┐  ┌──────────────┐   │
│  │  QR    │  │  https://... │   │  ← mono small
│  │ 120x120│  │  [Copy]      │   │
│  └────────┘  │  [Reset]     │   │
│              └──────────────┘   │
└──────────────────────────────────┘

┌──────────────────────────────────┐
│  VLESS · XTLS-REALITY            │
│  ┌────────┐  ┌──────────────┐   │
│  │  QR    │  │  vless://... │   │
│  │        │  │  [Copy]      │   │
│  └────────┘  └──────────────┘   │
└──────────────────────────────────┘

┌──────────────────────────────────┐
│  HYSTERIA 2                      │
│  ...                             │
└──────────────────────────────────┘
```

Protocol name в label — uppercase tracking-wide.

### ConfigEditor

```
┌─────────────────────────────────────────────────────────────┐
│ config.json  [● valid]      [Validate] [History]   [Apply] │  ← toolbar h-14
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   (Monaco editor — 70vh)                                     │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│  Read-only fields: clients[], privateKey, shortIds  ℹ️      │  ← help strip
└─────────────────────────────────────────────────────────────┘
```

- `[● valid]` — inline-indicator: lime dot + text «valid» / amber dot + «invalid».
- `[Apply]` — primary-button, только когда валидно и были изменения.
- `[History]` → DropdownMenu с последними 20 версиями + «Restore».
- Перед Apply → DiffDialog (split view) с подтверждением.

### DiffDialog

```
┌───────────────────────────────────────────────────────┐
│  Apply changes                              [×]       │
├───────────────────────────────────────────────────────┤
│  ⚠ This will restart Xray. Active connections will  │  ← Alert warning
│    be briefly dropped.                                │
├───────────────────────────────────────────────────────┤
│ ─ old ──────────────┬── new ──────────────            │
│  "port": 443,       │  "port": 8443,                  │  ← Monaco diff
│  "sni": "old..."    │  "sni": "new..."                │
├───────────────────────────────────────────────────────┤
│                    [Cancel]  [Apply changes]          │
└───────────────────────────────────────────────────────┘
```

Высота 80vh, ширина 90vw max 1200px.

### Form (CreateUserDialog)

```
Username
[ user_a3f9c1    ]  ← Input с auto-generated, Reload icon внутри

Traffic limit
[10GB] [50GB] [100GB] [500GB] [Unlimited]  ← PresetChips
[ Custom (GB): 25          ]               ← Input появляется при Custom

Expires in
[7 days] [30 days] [90 days] [1 year] [Never]  ← PresetChips
[ Custom date: [📅 ] ]                          ← появляется при Custom

Note (optional)
[ Friend from Riga          ]  ← Textarea, 3 rows

                      [Cancel]  [Create user →]
```

Right-aligned actions, primary с arrow-right иконкой.

### Sidebar

```
┌────────────────┐
│  ● MyPanel     │  ← logo + title, 56px header
├────────────────┤
│  □ Dashboard   │  ← active: lime leading border 2px, bg-active
│  👥 Users      │
│  📄 Configs  ▸ │  ← collapsible: Xray, Hysteria sub-items
│  ⚙ Settings  ▸ │  ← sub: Protocols, Domains, Admins
│  📜 Audit      │
├────────────────┤
│                │
│  (flex-1)      │
│                │
├────────────────┤
│  🔷 admin      │  ← user avatar + name, click → dropdown
└────────────────┘
```

Dark surface, `border-r`. Active item: leading 2px lime border + slight `bg-primary/5`.

---

## 10. Страницы админки

### LoginPage (`/login`)

Layout: центрированная карточка 400px на `bg-background`.

```
       [• MyPanel]  (logo lime)
       
       Welcome back
       Sign in to continue
       
       [ Username                  ]
       [ Password             [👁] ]
       [ 2FA code (if enabled)     ]
       
       [      Sign in →            ]  ← full-width primary
       
       — forgot password? is NOT here in v1 —
```

- Фон: subtle grid pattern (1px lines, 40px grid, `border` color).
- Logo: lime filled circle + `MyPanel` в serif italic.
- Никаких «Sign in with Google».

### DashboardPage (`/`)

```
Header: "Overview"  [1D][7D][30D]-toggle        last updated 12s ago

[MetricCard] [MetricCard] [MetricCard] [MetricCard]
 Active: 142  Online: 8    Traffic: 4.2GB  Xray: ●

┌─ Traffic (7 days) ─────────────┐  ┌─ Online now ─────┐
│                                 │  │ ● alice  124MB/s │
│  (Recharts area chart           │  │ ● bob    80MB/s  │
│   lime gradient, 300px height)  │  │ ● cindy  45MB/s  │
│                                 │  │                  │
└────────────────────────────────┘  └─────────────────┘

┌─ Kernel status ────────────────┐  ┌─ Recent activity ┐
│ Xray     ● Running  2d 4h      │  │ user.create ...  │
│ Hysteria ● Running  2d 4h      │  │ config.apply ... │
│ DB       ● Connected           │  │ user.delete ...  │
└────────────────────────────────┘  └─────────────────┘
```

Recharts: `AreaChart` с двумя сериями (upload/download), лайм и teal, area gradient fade-to-transparent-bottom.

### UsersPage (`/users`)

```
Header: "Users (142)"              [+ Create user]  (primary lime)

[🔍 Search by username...]  [Status: All ▾]  [Near expiry ☐]  ...more filters

[☐] USERNAME  STATUS    TRAFFIC          EXPIRES  CREATED     
[☐] alice     ●Active  ▓▓░░ 24% 12/50G   12d      Apr 3  [⋯]
[☐] bob       ●Active  ▓░░░ 08% 4/50G    45d      Apr 1  [⋯]
...

    ← ← 1 2 3 … 12 → →
```

- При выделенных (checkbox) — toolbar вверху трансформируется: `3 selected | [Disable] [Extend +30d] [Reset traffic] [Delete]`.
- Sticky header при скролле.

### ConfigsPage (`/configs/:core`)

Layout с tabs `Xray` | `Hysteria`, под ними ConfigEditor.

### SettingsPage (`/settings`)

Sidebar-nav слева внутри страницы (не основной sidebar):

```
┌───────────┬──────────────────────────────────────┐
│ Protocols │  Protocol settings                   │
│ Domains   │                                      │
│ Security  │  VLESS / Reality                     │
│ Admins    │  [Port]  [SNI]  [Dest]  [Short IDs]  │
│ 2FA       │  Rotate Reality keys  [Rotate]       │
│ Backup    │                                      │
│           │  Hysteria 2                          │
│           │  [Port] [Obfs] [Bandwidth up/down]   │
│           │                                      │
│           │  [Save changes]                      │
└───────────┴──────────────────────────────────────┘
```

### AuditPage (`/audit`)

Table с timeline-style:

```
Apr 19  15:32   admin        user.create       alice
Apr 19  15:30   admin        config.apply      xray (v23)
Apr 19  14:22   system       user.auto_limit   bob (traffic)
```

- `system` actor — другой цвет текста (muted).
- Hover row → HoverCard с полным metadata JSON (моно).

---

## 11. Страница подписки

**URL:** `/u/:token`. Mobile-first, максимальная ширина 480px, центрирована.

### Layout

```
       [● symbol — lime shield icon 32px]

                MyVPN               ← Instrument Serif italic, 56px
         Your secure connection      ← Sans 14px muted

         ┌───────────────────┐
         │                   │
         │    [ QR 260x260 ] │       ← чёрный QR на surface-sunken
         │                   │
         └───────────────────┘

         [ 🔗 Copy subscription link ]  ← large button

         ───────────────────────────

         USED                           ← t-label
         ▓▓▓▓▓░░░░░░░░░░ 24%
         4.2 GB of 50 GB

         EXPIRES
         12 days left
         (Apr 31, 2026)

         ───────────────────────────

         CONNECT WITH ONE TAP           ← t-label
         [ 📱 Streisand    → ]
         [ 📱 Hiddify      → ]
         [ 📱 Karing       → ]

         ───────────────────────────

         ▾ How to connect?              ← Accordion
         ▾ Advanced (individual keys)    ← Collapsible

         ───────────────────────────

         [Reset my link]  ← ghost small
```

### Детали

- **Hero** — `MyVPN` в Instrument Serif italic, чуть наклон. Subtitle — Sans.
- **QR card** — `bg-surface` с внутренней паддингой 24px. QR сгенерирован бэком с lime corner eye-pattern (опционально, через query-параметр).
- **Copy button** — `size="lg"` full-width, default variant (lime), с иконкой `Link2`.
- **Usage bar** — кастомный `<TrafficBar>`: lime fill → amber при > 70% → destructive при > 90%. Анимация при маунте: slide-in ширины от 0 до target 600ms ease-out.
- **Expiry** — крупный текст «12 days left», subtitle с датой. При < 3 дней — текст warning цвета.
- **Client buttons** — Card-подобные с иконкой клиента слева (не Lucide, а favicons клиентов — Streisand, Hiddify и т.д., хранятся локально как SVG), названием по центру, `ChevronRight` справа. При tap — deep link.
- **«How to connect?» accordion** — 3 секции (iOS / Android / Desktop) со step-by-step и скриншотами.
- **«Advanced» collapsible** — три мини-QR для VLESS и Hysteria 2 отдельно, с подписями в моно-шрифте.

### Light theme для подписки

- Background `#FAF8F4` (тёплый off-white).
- Serif остаётся Instrument.
- Lime приглушается до `#84B800`.
- QR — белый фон.
- Теплее, ламповее — для ощущения «продукта».

---

## 12. Empty states, loading, errors

### Empty state

Никогда пустой экран. Всегда:

```
       [icon 48px, muted]

       No users yet
       Create your first user to get started

       [+ Create user]
```

- Illustration — Lucide иконка в большом размере с opacity 0.4.
- Заголовок — 18px semibold.
- Описание — 13px muted.
- CTA — primary button.

### Loading

- **Skeleton** для всего списочного (таблицы, карточки дашборда).
- **Spinner** (Loader2 icon rotating) только в кнопках во время мутации.
- **Progress bar сверху** (nprogress-стиль, lime, 2px) для навигации между роутами.

Skeleton паттерн:

```tsx
<Skeleton className="h-4 w-32" />       // текст
<Skeleton className="h-20 w-full" />    // карточка
<Skeleton className="h-9 w-24 rounded-md" />  // кнопка
```

Shimmer эффект — linear-gradient 90deg с `skeleton-shimmer` keyframe.

### Error states

| Ситуация | Отображение |
|----------|-------------|
| API 401 | Redirect → `/login` |
| API 404 на `/sub/:token` | Отдельная страница «This link is no longer valid» |
| API 500 в админке | Toast с текстом + кнопкой Retry |
| Network error | Toast «Connection lost. Retrying...» с автоматическим retry |
| Form validation | Inline под полем, destructive цвет, иконка `AlertCircle` |
| Destructive confirmation | AlertDialog, красная primary action |

Сообщения — из словаря `humanizeError`, никогда не показывать raw stack trace.

---

## 13. Адаптивность

### Админка

- **< 768px (mobile)** — read-only. Показываем только Dashboard и UsersPage со списком. Редактирование конфигов, создание юзеров — «Please use desktop» с иллюстрацией.
- **768-1024px (tablet)** — работает, но sidebar collapsed по умолчанию, некоторые колонки в таблицах скрыты.
- **> 1024px (desktop)** — полный функционал.

### Страница подписки

- **< 360px** — QR уменьшается до 220px, остальное адаптируется.
- **360-768px** — primary target, максимальная ширина 480px.
- **> 768px** — остаётся 480px центрированным, добавляется декоративный фон (grid pattern или subtle gradient по сторонам).

### Touch vs mouse

- Touch — hit targets минимум 44px.
- Hover states скрываются на touch устройствах (через `@media (hover: hover)`).

---

## 14. tailwind.config и global.css

### `tailwind.config.ts`

```ts
import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans:  ['Geist', 'ui-sans-serif', 'system-ui'],
        serif: ['Instrument Serif', 'ui-serif', 'Georgia'],
        mono:  ['JetBrains Mono', 'ui-monospace'],
      },
      colors: {
        border:           'hsl(var(--border))',
        'border-strong':  'hsl(var(--border-strong))',
        background:       'hsl(var(--background))',
        foreground:       'hsl(var(--foreground))',
        surface:          'hsl(var(--surface))',
        'surface-elevated': 'hsl(var(--surface-elevated))',
        'surface-sunken': 'hsl(var(--surface-sunken))',
        primary: {
          DEFAULT:    'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        success: {
          DEFAULT:    'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        destructive: {
          DEFAULT:    'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        warning: {
          DEFAULT:    'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        muted: {
          DEFAULT:    'hsl(var(--surface))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        faint: 'hsl(var(--faint-foreground))',
        ring:  'hsl(var(--ring))',
      },
      borderRadius: {
        lg: '8px',
        md: '6px',
        sm: '4px',
      },
      keyframes: {
        'pulse-ring': {
          '0%':   { boxShadow: '0 0 0 0 hsl(var(--success) / 0.6)' },
          '70%':  { boxShadow: '0 0 0 6px hsl(var(--success) / 0)' },
          '100%': { boxShadow: '0 0 0 0 hsl(var(--success) / 0)' },
        },
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 0 0 hsl(var(--primary) / 0)' },
          '50%':      { boxShadow: '0 0 8px 2px hsl(var(--primary) / 0.35)' },
        },
      },
      animation: {
        'pulse-ring': 'pulse-ring 2s ease-out infinite',
        'glow-pulse': 'glow-pulse 1.8s ease-in-out infinite',
      },
    },
  },
  plugins: [animate],
} satisfies Config;
```

### `global.css`

```css
@import 'tailwindcss';

@layer base {
  :root {
    /* (все переменные из секции 3) */
  }
  
  * {
    border-color: hsl(var(--border));
  }

  body {
    background: hsl(var(--background));
    color: hsl(var(--foreground));
    font-family: var(--font-sans);
    font-size: 13px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    font-feature-settings: 'cv11', 'ss01';  /* Geist stylistic sets */
  }

  code, pre, .mono {
    font-family: var(--font-mono);
    font-feature-settings: 'liga' off;
  }

  /* кастомный scrollbar */
  ::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: hsl(var(--border));
    border-radius: 6px;
    border: 2px solid hsl(var(--background));
  }
  ::-webkit-scrollbar-thumb:hover {
    background: hsl(var(--border-strong));
  }

  /* selection */
  ::selection {
    background: hsl(var(--primary) / 0.3);
    color: hsl(var(--foreground));
  }

  /* focus ring */
  :focus-visible {
    outline: 2px solid hsl(var(--ring));
    outline-offset: 2px;
  }
}

@layer utilities {
  .t-label {
    font-size: 11px;
    font-weight: 500;
    line-height: 1.4;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: hsl(var(--muted-foreground));
  }

  .bg-grid {
    background-image:
      linear-gradient(to right, hsl(var(--border) / 0.3) 1px, transparent 1px),
      linear-gradient(to bottom, hsl(var(--border) / 0.3) 1px, transparent 1px);
    background-size: 40px 40px;
  }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## Чеклист перед началом разработки UI

- [ ] Шрифты (Geist, Instrument Serif, JetBrains Mono) подключены в `index.html` с `preconnect`.
- [ ] CSS variables из секции 3 скопированы в `global.css`.
- [ ] `tailwind.config.ts` настроен с кастомными цветами, шрифтами, keyframes.
- [ ] Shadcn инициализирован с `darkMode: class`, base color neutral.
- [ ] Установлены все критичные shadcn компоненты (секция 5).
- [ ] Lucide-react установлен.
- [ ] `prefers-reduced-motion` обработан глобально.
- [ ] Кастомные компоненты (`StatusBadge`, `TrafficBar`, `CopyButton`, `MonoField`, `MetricCard`, `DurationBadge`) реализованы как базовые блоки.
- [ ] Layout с sidebar-07 адаптирован под наш набор маршрутов и иконок.
- [ ] Theme провайдер: админка форсит dark, subscription страница — system preference.

---

## Итог

Дизайн-язык: **тёмный minimal + electric lime акцент + Geist/Instrument Serif/JetBrains Mono**. Плотная админка для инженерной работы, воздушная subscription-страница с serif-заголовком для конечного пользователя. Один bold акцент, который появляется только в ключевых моментах. Никаких стоковых AI-визуалов.

Вместе с SPEC.md этого достаточно, чтобы агент построил полноценный продукт без додумывания визуальных решений.
