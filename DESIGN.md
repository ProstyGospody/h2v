# VPN Panel — Design System

> Visual specification accompanying SPEC.md. Everything needed for pixel-perfect frontend implementation: fonts, colors, blocks, components, icons, patterns.

---

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
2. [Typography](#2-typography)
3. [Color System](#3-color-system)
4. [Shadcn Blocks (pre-built)](#4-shadcn-blocks-pre-built)
5. [Shadcn Components (full list)](#5-shadcn-components-full-list)
6. [Lucide Icons](#6-lucide-icons)
7. [Spacing and Grid](#7-spacing-and-grid)
8. [Motion (animations)](#8-motion-animations)
9. [Component Patterns](#9-component-patterns)
10. [Admin Pages](#10-admin-pages)
11. [Subscription Page](#11-subscription-page)
12. [Empty States, Loading, Errors](#12-empty-states-loading-errors)
13. [Responsive Behavior](#13-responsive-behavior)
14. [tailwind.config and global.css](#14-tailwindconfig-and-globalcss)

---

## 1. Design Philosophy

### Direction

**Refined technical minimalism.** A black base, one poisonously bright accent, monospace typography for everything technical, a serif display face for accents on the user-facing page. No rounding for rounding's sake, no gradient blobs, no stock icons the size of a button.

Spiritual references: Linear dashboard × Arc browser × ProtonVPN, but with its own character through the accent color and typography pairing.

### Two contexts, two moods

- **Admin** — dense, technical, dark mode only. Lots of data in tables, monospace for anything that reads as "key/token/URI", generous padding inside cards, thin 1px borders, minimal shadows. Feel: "professional instrument."
- **User subscription page** — airy, larger type, serif accent, more whitespace, both light and dark themes (optionally follows system). Feel: "product, not admin tool."

### Rules with no exceptions

- **No Inter, Roboto, Arial, or system-ui** in the design.
- **No purple gradients.** One accent: electric lime.
- **No rounded-full buttons as primary action.** Buttons are rectangular with `rounded-md` (6px).
- **No drop-shadow on top of drop-shadow.** Shadows are rare and functional.
- **No decorative emoji in UI.** Lucide icons only.
- **All secrets, UUIDs, URIs — JetBrains Mono only.** Always.

---

## 2. Typography

### Fonts

| Role | Font | Source | Usage |
|------|------|--------|-------|
| **Sans** (UI) | **Geist Sans** | Vercel fonts / Google Fonts | All admin UI: buttons, menus, tables, forms |
| **Serif** (display) | **Instrument Serif** | Google Fonts | Headings on the user-facing subscription page |
| **Mono** | **JetBrains Mono** | Google Fonts | UUIDs, tokens, URIs, configs, secrets, error codes |

Loading in `index.html`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" crossorigin />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500;600&display=swap"
  rel="stylesheet"
/>
```

Via CSS variables:

```css
:root {
  --font-sans: "Geist", ui-sans-serif, system-ui, sans-serif;
  --font-serif: "Instrument Serif", ui-serif, Georgia, serif;
  --font-mono: "JetBrains Mono", ui-monospace, "SF Mono", monospace;
}
```

### Size scale

Tailwind scale with clarifications:

| Class | Size | Line-height | Usage |
|-------|------|-------------|-------|
| `text-xs` | 11px | 16px | Labels, badges, table column headers, captions |
| `text-sm` | 13px | 20px | Base body for admin, forms, tables |
| `text-base` | 14px | 22px | Larger body (UserDrawer, modals) |
| `text-lg` | 16px | 24px | Card titles |
| `text-xl` | 18px | 28px | H3 in settings |
| `text-2xl` | 22px | 30px | H2 (page sections) |
| `text-3xl` | 28px | 36px | H1 on admin pages |
| `text-5xl` | 48px | 56px | H1 on user page (serif) |
| `text-7xl` | 72px | 80px | Hero "MyVPN" on subscription page (serif) |

Admin runs at `text-sm` by default (13px). That's denser than 14-15px Bootstrap territory and shows more info per screen.

### Weights

- **400 Regular** — all body text.
- **500 Medium** — labels, section headers.
- **600 Semibold** — headings, buttons, primary text in metrics.
- **700 Bold** — very rarely, only for "huge numbers" in the dashboard.

No `font-light` / `font-thin` — they read poorly on monitors.

### Typographic tokens

```css
/* admin */
.t-metric    { font: 600 28px/1.1 var(--font-sans); letter-spacing: -0.02em; }
.t-h1        { font: 600 24px/1.2 var(--font-sans); letter-spacing: -0.01em; }
.t-h2        { font: 600 18px/1.3 var(--font-sans); letter-spacing: -0.005em; }
.t-label     { font: 500 11px/1.4 var(--font-sans); letter-spacing: 0.06em; text-transform: uppercase; }
.t-body      { font: 400 13px/1.5 var(--font-sans); }
.t-code      { font: 400 12px/1.5 var(--font-mono); letter-spacing: -0.01em; }

/* user-facing */
.t-hero      { font: 400 72px/0.95 var(--font-serif); letter-spacing: -0.02em; }
.t-display   { font: 400 48px/1.05 var(--font-serif); letter-spacing: -0.015em; }
.t-sublead   { font: 400 18px/1.55 var(--font-sans); color: var(--muted-foreground); }
```

`.t-label` — always UPPERCASE with 6% tracking. This is the only case of uppercase. Gives labels an "engineering" feel.

Serif in headings on the user page is the one "beautiful" gesture in the product. A deliberate contrast against the functional admin.

---

## 3. Color System

### Palette (dark mode — default)

All colors in HSL for smooth opacity manipulation.

```css
:root {
  /* Base surfaces */
  --background:       220 12% 5%;      /* #0B0C0E — base, almost-black with cool cast */
  --surface:          220 10% 8%;      /* #131417 — cards */
  --surface-elevated: 220 9% 11%;      /* #1B1C20 — popovers, dropdowns, tooltips */
  --surface-sunken:   220 14% 3%;      /* #07080A — inputs, code blocks */

  /* Borders */
  --border:           220 8% 16%;      /* #25272C — base */
  --border-strong:    220 7% 22%;      /* #34363C — hover, focus-visible */

  /* Text */
  --foreground:       210 17% 96%;     /* #F2F4F7 — primary */
  --muted-foreground: 220 6% 62%;      /* #979AA2 — secondary */
  --faint-foreground: 220 5% 42%;      /* #63666D — hints, placeholders */

  /* Accent — electric lime */
  --primary:          74 100% 60%;     /* #C4F533 — actions, focus, active */
  --primary-foreground: 220 14% 6%;    /* dark text on lime */
  --primary-glow:     74 100% 60% / 0.22;   /* for subtle box-shadow */

  /* Secondary accent — teal (rare, for "success" and online) */
  --success:          165 90% 50%;     /* #0FE8B8 */
  --success-foreground: 220 14% 6%;

  /* Status */
  --destructive:      0 84% 62%;       /* #EF4444 — warm red */
  --destructive-foreground: 210 17% 96%;
  --warning:          38 95% 55%;      /* #F7A11A — amber */
  --warning-foreground: 220 14% 6%;
  --info:             210 90% 60%;     /* #3D8AF2 — used sparingly */

  /* Interactive states */
  --hover-overlay:    210 17% 96% / 0.04;    /* barely visible highlight */
  --active-overlay:   210 17% 96% / 0.08;
  --ring:             74 100% 60% / 0.45;    /* focus-visible */

  /* Charts */
  --chart-1: 74 100% 60%;    /* lime */
  --chart-2: 165 90% 50%;    /* teal */
  --chart-3: 38 95% 55%;     /* amber */
  --chart-4: 210 90% 60%;    /* blue */
  --chart-5: 280 70% 70%;    /* subtle purple — only when 5 series needed */
}
```

### Palette (light mode — subscription page only)

```css
[data-theme="light"] {
  --background:       45 25% 97%;      /* #FAF8F4 — warm off-white */
  --surface:          0 0% 100%;
  --surface-elevated: 0 0% 100%;
  --surface-sunken:   45 20% 94%;
  --border:           40 10% 88%;
  --border-strong:    40 8% 76%;
  --foreground:       220 14% 8%;
  --muted-foreground: 220 6% 42%;
  --primary:          74 85% 42%;      /* muted lime for daylight */
  --primary-foreground: 0 0% 100%;
  --destructive:      0 72% 48%;
  --success:          165 70% 35%;
}
```

Admin is **dark only**. Light theme unneeded. Subscription page switches on `prefers-color-scheme`.

### Color usage rules

- **80% of screen** — `background` + `surface`. The base dark environment.
- **15%** — `foreground` + `muted-foreground` (text).
- **4%** — `border`, dividers.
- **1%** — **accent** (`primary`). Used with precision: hover-states on action buttons, active sidebar item, input focus, traffic progress bar, "online" dot.

The less accent, the stronger it reads. "Save" and "Create" buttons — not lime-filled, but `surface-elevated` with lime border/text. Lime fill only on the **one** main CTA per page (e.g., `Apply` in the config editor).

### Status semantics

| User status | Color | Application |
|-------------|-------|-------------|
| `active` | `success` | Dot in Badge, borderless |
| `disabled` | `muted-foreground` | Badge outline |
| `expired` | `warning` | Badge outline |
| `limited` | `destructive` | Badge outline |

Status dots — 6px circle, `active` pulses via `@keyframes pulse-ring`.

---

## 4. Shadcn Blocks (pre-built)

Shadcn provides official blocks at `ui.shadcn.com/blocks`. We take them as starting points and adapt to our palette and fonts.

| Shadcn block | Where used | Adaptation |
|--------------|------------|------------|
| **sidebar-07** or **sidebar-08** | Main admin layout (collapsible sidebar + main area) | Swap primary color to lime, icons to our Lucide set, custom logo |
| **dashboard-01** | DashboardPage structure (card grid + chart + table) | Use Recharts area chart with lime gradient, simplify cards |
| **login-03** | LoginPage | Remove social providers, username/password + TOTP field only |
| **login-04** | Alternative LoginPage (split with image) | Right panel: large serif logo + tagline |
| **authentication-01** | Recovery flows (reset password) — for v2 | — |

### Custom blocks (hand-assembled)

Shadcn doesn't provide these — we assemble from primitives:

- **UserDrawer** — Sheet on the right, 560px wide, with inner Tabs (Details / Links / Traffic).
- **ConfigEditor** — full-screen area with Monaco + top toolbar (Validate / Apply / History) + diff-dialog.
- **UserLinksPanel** — three stacked cards (Subscription / VLESS / Hysteria 2) with QR and copy actions.
- **SubscriptionPage** — centered layout, 480px max-width, QR + progress + client buttons.

---

## 5. Shadcn Components (full list)

Install via CLI. Grouped by priority.

### Critical (install first)

```bash
npx shadcn@latest add button badge card input label form \
  table dropdown-menu dialog sheet drawer tabs separator \
  skeleton sonner alert alert-dialog tooltip sidebar
```

| Component | Key usage |
|-----------|-----------|
| `button` | All actions. Variants: default, secondary, outline, ghost, destructive, link |
| `badge` | User statuses (dot + text), tags, version tags in history |
| `card` | Everywhere. Always through `<Card><CardHeader><CardContent></Card>` |
| `input` | Forms, table search |
| `label` | Paired with Input, always. `t-label` styling |
| `form` | React Hook Form + Zod wrappers, for CreateUserDialog and Settings |
| `table` | UsersPage, AuditPage, ConfigHistoryDialog |
| `dropdown-menu` | Row context menus, user avatar, config history |
| `dialog` | CreateUserDialog, ConfirmDeleteUser, DiffDialog, sub_token reset |
| `sheet` | UserDrawer (right, 560px), Settings panels on mobile |
| `drawer` | Bottom sheet on mobile (via vaul) instead of Sheet |
| `tabs` | Inside UserDrawer, SettingsPage, ConfigsPage (Xray / Hysteria) |
| `separator` | Dividers inside Cards and menus |
| `skeleton` | All loading states |
| `sonner` | Toasts (success/error on mutations) |
| `alert` | Inline warnings, e.g., DiffDialog "will restart kernel" |
| `alert-dialog` | Destructive confirmations: delete user, revert config |
| `tooltip` | Hover hints on icons, read-only config fields, truncated values |
| `sidebar` | Admin navigation (from sidebar-07) |

### Secondary

```bash
npx shadcn@latest add select switch checkbox textarea \
  progress popover command hover-card avatar breadcrumb \
  pagination collapsible accordion scroll-area chart \
  navigation-menu toggle toggle-group radio-group calendar \
  date-picker number-input
```

| Component | Key usage |
|-----------|-----------|
| `select` | Status filter, core in history, admin role |
| `switch` | Toggles in Settings (obfs enabled, 2FA) |
| `checkbox` | Bulk-select in user table |
| `textarea` | Note field, audit dialog |
| `progress` | User traffic progress bar (customized with lime fill) |
| `popover` | Table filters (faceted filter), popover with full value for truncated text |
| `command` | Global search (Cmd+K): jump to user, page, setting |
| `hover-card` | User preview when hovering username in audit log |
| `avatar` | Admin avatars (initials on surface-elevated, no images) |
| `breadcrumb` | Deep sections: Settings > Admins > Edit |
| `pagination` | User and audit tables (when > 50 rows) |
| `collapsible` | "Advanced" section on SubscriptionPage |
| `accordion` | "How to connect?" on SubscriptionPage |
| `scroll-area` | Inside Sheet, custom scrollbar (thin, lime on hover) |
| `chart` | Recharts wrapper from shadcn. Traffic chart, user growth chart |
| `navigation-menu` | Top-bar in layout (user menu on the right) |
| `toggle` / `toggle-group` | Time range selector on dashboard (1D / 7D / 30D) |
| `radio-group` | Theme selection in Settings (system/dark/light) |
| `calendar` + `date-picker` | `expires_at` in CreateUserDialog |
| `number-input` | Traffic limit, ports |

### Third-party (via npm, not shadcn CLI)

| Package | Purpose |
|---------|---------|
| `@monaco-editor/react` | Config editor |
| `recharts` | Charts (wrapped in shadcn `chart`) |
| `sonner` | Toasts (already bundled with shadcn add) |
| `vaul` | Mobile drawer (bundled with shadcn drawer) |
| `@tanstack/react-virtual` | Virtualized user table (> 200 rows) |
| `qrcode.react` | Client-side QR fallback (primary is backend) |
| `@tanstack/react-table` | Table with filters/sorting (wrapped in shadcn) |

### Custom components built on top of shadcn

Written ourselves, extending shadcn primitives:

- **`<StatusBadge status>`** — Badge with colored dot (pulse for active).
- **`<TrafficBar used total>`** — custom Progress with color scale (lime → amber → destructive as it approaches limit).
- **`<CopyButton value>`** — IconButton (Copy → Check for 2 seconds after click).
- **`<MonoField value>`** — inline block with mono font, border, and `<CopyButton>`.
- **`<QRCard value label>`** — Card with centered QR and caption, Copy button below.
- **`<MetricCard label value delta icon>`** — dashboard cards.
- **`<DurationBadge expires>`** — Badge "12d left", warning when < 3 days, destructive at 0.
- **`<KernelStatusIndicator core>`** — dot + text "Xray running / Xray error" for kernel status.
- **`<PasswordField>`** — Input with eye-toggle visibility.
- **`<PresetChips options selected onChange>`** — horizontal row of preset chips (for traffic limit, expires).

---

## 6. Lucide Icons

**The only icon library.** Default size 16px (`h-4 w-4`), buttons 14px, large accents 20px. Stroke width 1.75 (slightly thinner than the default 2).

### Map: what icon goes where

**Sidebar navigation:**
- Dashboard → `LayoutDashboard`
- Users → `Users`
- Configs → `FileCode2`
- Settings → `Settings2`
- Audit → `ScrollText`
- Logs (separate page if needed) → `Terminal`

**User actions:**
- Create → `UserPlus`
- Edit → `Pencil`
- Delete → `Trash2`
- Disable → `Ban`
- Enable → `CheckCircle2`
- Reset traffic → `RotateCcw`
- Reset token → `RefreshCw`
- Copy → `Copy` (after click → `Check` for 2 seconds)
- QR code → `QrCode`
- Extend expiry → `CalendarPlus`

**Status:**
- Active → `Circle` (lime fill)
- Disabled → `Circle` (muted fill)
- Expired → `Clock`
- Limited → `Gauge` (with fill)
- Online → `Zap` (pulses lime)

**Navigation and UI:**
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

**Configs and files:**
- Config editor → `FileJson2` (Xray), `FileText` (Hysteria YAML)
- Validate → `CircleCheck`
- Apply → `PlayCircle`
- History → `History`
- Restore version → `Undo2`
- Download → `Download`
- Upload → `Upload`
- Diff view → `GitCompare`

**System and kernels:**
- Xray → `Shield` (protocol)
- Hysteria → `Zap` (fast)
- Server/VDS → `Server`
- Database → `Database`
- Restart → `RotateCw`
- Healthy → `Activity`
- Error → `AlertCircle`
- Warning → `AlertTriangle`

**Auth and security:**
- Login → `LogIn`
- Logout → `LogOut`
- Lock → `Lock`
- Unlock → `Unlock`
- Eye (show password) → `Eye`
- EyeOff → `EyeOff`
- 2FA → `ShieldCheck`
- Key → `Key`

**Traffic and metrics:**
- Upload → `ArrowUp`
- Download → `ArrowDown`
- Speed → `Gauge`
- Bandwidth → `Activity`
- Line chart → `LineChart`
- Area chart → `AreaChart`
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
- iOS Streisand → `AppWindow` (or `Smartphone`)
- Reset sub → `RefreshCw`

### Usage rules

- **Never mix icon styles.** Lucide outline only. No filled icons from other sets.
- **Buttons with icons**: icon on the left, text on the right, gap 8px (`gap-2`).
- **Icon-only buttons** — mandatory `<Tooltip>` with action description.
- **Size in buttons**: `size="sm"` button uses 14px icon, `size="default"` uses 16px.
- **No emoji.** Ever. Not even in empty states.

---

## 7. Spacing and Grid

### Tailwind spacing scale

Standard Tailwind scale, no customization:
`0 / 1 (4px) / 2 (8px) / 3 (12px) / 4 (16px) / 5 (20px) / 6 (24px) / 8 (32px) / 10 (40px) / 12 (48px) / 16 (64px) / 20 (80px) / 24 (96px)`

### Base rules

- **Padding inside Card**: `p-6` (24px) on sides, `py-5` for compact variants.
- **Gap between Cards**: `gap-4` (16px) in grid, `gap-6` for major sections.
- **Padding inside Button**: `sm` — `px-3 h-8`, `default` — `px-4 h-9`, `lg` — `px-6 h-10`. All buttons on a page should be the same size.
- **Form field gap**: `space-y-2` between Label and Input, `space-y-4` between fields.
- **Section padding**: admin pages — `p-6 lg:p-8`.
- **Container max-width**: admin `max-w-[1600px]`, subscription — `max-w-[480px]`.

### Admin layout (desktop)

```
┌────────────────────────────────────────────────────────────┐
│  Sidebar 240px  │  Main area (fluid, max-w-1600)           │
│  (collapsible   │  ┌─────────────────────────────────────┐ │
│   to 64px)      │  │  Top bar 56px                       │ │
│                 │  ├─────────────────────────────────────┤ │
│                 │  │  Page content                       │ │
│                 │  │  padding: 24px / 32px lg            │ │
│                 │  │                                     │ │
│                 │  └─────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

Collapsed sidebar (64px) shows only icons + hover tooltip. State persists in localStorage.

### Dashboard grid

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

| Breakpoint | Width | Usage |
|------------|-------|-------|
| `sm` | 640px | Mobile landscape / small tablet |
| `md` | 768px | Tablet |
| `lg` | 1024px | Desktop — primary target |
| `xl` | 1280px | Wide desktop |
| `2xl` | 1536px | Ultra-wide |

Admin starts at `md` (mobile is read-only). SubscriptionPage is fully mobile-first.

---

## 8. Motion (animations)

### Principles

1. **Fast and unobtrusive for UI actions.** Hover 150ms, click 100ms.
2. **Entrance and exit — 200/150ms ease-out.** Dialog, Sheet, Drawer.
3. **No bounce, spring, or elastic.** Only `ease-out`, `cubic-bezier(0.16, 1, 0.3, 1)` for slightly more "expressive."
4. **Stagger in lists — only once on first load.** Not on every update.
5. **Reduce motion.** Always `@media (prefers-reduced-motion: reduce)` disabling everything except fades.

### Tokens

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

### Micro-animation catalog

| Element | Animation |
|---------|-----------|
| Button hover | `transition: background 100ms ease-out, transform 100ms` + `active:scale-[0.98]` |
| Card hover (clickable) | `transition: border-color 150ms, background 150ms` + border → `border-strong` |
| Dialog enter | `fade-in 150ms + scale from 0.96 to 1 150ms ease-out` |
| Sheet enter | `slide-in from right 200ms ease-out` |
| Drawer (mobile) | `slide-in from bottom 250ms ease-out` |
| Tooltip | delay 500ms, fade 100ms |
| Skeleton | `pulse 1.5s ease-in-out infinite` |
| Status dot (active) | `pulse-ring 2s ease-out infinite` — expanding ring 0→150% with opacity 0.5→0 |
| Toast (sonner) | sonner defaults, accepted |
| Copy button → Check | swap icons, scale `from 0.5 to 1` 150ms, hold 2s, fade back |
| Route transition | `fade 100ms` (no slide — avoids distraction) |
| Online dot | `glow-pulse 1.8s` — box-shadow 0 0 0→8px lime fade out |

### Custom keyframes

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

## 9. Component Patterns

### Card (base)

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

- 1px border `--border`.
- Background `--surface`.
- Padding `p-6`, header `pb-4`.
- No shadow by default.
- Hover (if clickable) — border → `--border-strong` + `bg-hover-overlay`.

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

- Icon in the top-left, `muted-foreground`.
- Positive delta — `text-success`, negative — `text-destructive`.

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

- For `active` — with pulse-ring.
- For others — static dot.

### Table (user table)

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
- `⋯` button → `DropdownMenu` (Edit, Reset traffic, Reset token, Delete).
- Selected rows — leading lime border 2px + `bg-active-overlay`.

### UserDrawer (Sheet right, 560px)

```
┌──────────────────────────────────┐
│  alice          [⋯]  [×]         │  ← header
│  ● Active · Created Apr 3        │
├──────────────────────────────────┤
│  [Details] [Links] [Traffic]     │  ← Tabs
├──────────────────────────────────┤
│                                  │
│  (tab content)                   │
│                                  │
└──────────────────────────────────┘
```

- Header: username (text-xl semibold) + status row below.
- `⋯` button for actions (Disable, Reset..., Delete).
- Tabs sticky below header on scroll.

### UserLinksPanel (Links tab)

Three stacked Cards:

```
┌──────────────────────────────────┐
│  SUBSCRIPTION                    │  ← label uppercase
│                                  │
│  ┌────────┐  ┌──────────────┐    │
│  │  QR    │  │  https://... │    │  ← mono small
│  │ 120x120│  │  [Copy]      │    │
│  └────────┘  │  [Reset]     │    │
│              └──────────────┘    │
└──────────────────────────────────┘

┌──────────────────────────────────┐
│  VLESS · XTLS-REALITY            │
│  ┌────────┐  ┌──────────────┐    │
│  │  QR    │  │  vless://... │    │
│  │        │  │  [Copy]      │    │
│  └────────┘  └──────────────┘    │
└──────────────────────────────────┘

┌──────────────────────────────────┐
│  HYSTERIA 2                      │
│  ...                             │
└──────────────────────────────────┘
```

Protocol name in label — uppercase, tracking-wide.

### ConfigEditor

```
┌─────────────────────────────────────────────────────────────┐
│ config.json  [● valid]      [Validate] [History]   [Apply] │  ← toolbar h-14
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   (Monaco editor — 70vh)                                    │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  Read-only fields: clients[], privateKey, shortIds  ℹ      │  ← help strip
└─────────────────────────────────────────────────────────────┘
```

- `[● valid]` — inline indicator: lime dot + text "valid" / amber dot + "invalid".
- `[Apply]` — primary button, enabled only when valid and changes exist.
- `[History]` → DropdownMenu with last 20 versions + "Restore".
- Before Apply → DiffDialog (split view) with confirmation.

### DiffDialog

```
┌───────────────────────────────────────────────────────┐
│  Apply changes                              [×]       │
├───────────────────────────────────────────────────────┤
│  ⚠ This will restart Xray. Active connections will   │  ← Alert warning
│    be briefly dropped.                                │
├───────────────────────────────────────────────────────┤
│ ─ old ──────────────┬── new ──────────────            │
│  "port": 443,       │  "port": 8443,                  │  ← Monaco diff
│  "sni": "old..."    │  "sni": "new..."                │
├───────────────────────────────────────────────────────┤
│                    [Cancel]  [Apply changes]          │
└───────────────────────────────────────────────────────┘
```

Height 80vh, width 90vw max 1200px.

### Form (CreateUserDialog)

```
Username
[ user_a3f9c1    ]  ← Input with auto-generated value, Reload icon inside

Traffic limit
[10GB] [50GB] [100GB] [500GB] [Unlimited]  ← PresetChips
[ Custom (GB): 25          ]               ← Input shown when Custom

Expires in
[7 days] [30 days] [90 days] [1 year] [Never]  ← PresetChips
[ Custom date: [📅 ] ]                          ← shown when Custom

Note (optional)
[ Friend from Riga          ]  ← Textarea, 3 rows

                      [Cancel]  [Create user →]
```

Right-aligned actions, primary with arrow-right icon.

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

Dark surface, `border-r`. Active item: leading 2px lime border + subtle `bg-primary/5`.

---

## 10. Admin Pages

### LoginPage (`/login`)

Layout: centered 400px card on `bg-background`.

```
       [• MyPanel]  (lime logo)
       
       Welcome back
       Sign in to continue
       
       [ Username                  ]
       [ Password             [👁] ]
       [ 2FA code (if enabled)     ]
       
       [      Sign in →            ]  ← full-width primary
       
       — "forgot password?" is NOT here in v1 —
```

- Background: subtle grid pattern (1px lines, 40px grid, `border` color).
- Logo: lime filled circle + `MyPanel` in serif italic.
- No "Sign in with Google."

### DashboardPage (`/`)

```
Header: "Overview"  [1D][7D][30D]-toggle        last updated 12s ago

[MetricCard] [MetricCard] [MetricCard] [MetricCard]
 Active: 142  Online: 8    Traffic: 4.2GB  Xray: ●

┌─ Traffic (7 days) ─────────────┐  ┌─ Online now ─────┐
│                                │  │ ● alice  124MB/s │
│  (Recharts area chart          │  │ ● bob    80MB/s  │
│   lime gradient, 300px height) │  │ ● cindy  45MB/s  │
│                                │  │                  │
└────────────────────────────────┘  └──────────────────┘

┌─ Kernel status ────────────────┐  ┌─ Recent activity ┐
│ Xray     ● Running  2d 4h      │  │ user.create ...  │
│ Hysteria ● Running  2d 4h      │  │ config.apply ... │
│ DB       ● Connected           │  │ user.delete ...  │
└────────────────────────────────┘  └──────────────────┘
```

Recharts: `AreaChart` with two series (upload/download), lime and teal, area gradient fading to transparent at the bottom.

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

- With checkboxes selected — the toolbar transforms: `3 selected | [Disable] [Extend +30d] [Reset traffic] [Delete]`.
- Sticky header on scroll.

### ConfigsPage (`/configs/:core`)

Layout with tabs `Xray` | `Hysteria`, ConfigEditor below.

### SettingsPage (`/settings`)

Inner sidebar-nav on the left (not the main sidebar):

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

Table in timeline style:

```
Apr 19  15:32   admin        user.create       alice
Apr 19  15:30   admin        config.apply      xray (v23)
Apr 19  14:22   system       user.auto_limit   bob (traffic)
```

- `system` actor — different text color (muted).
- Row hover → HoverCard with full metadata JSON (mono).

---

## 11. Subscription Page

**URL:** `/u/:token`. Mobile-first, max width 480px, centered.

### Layout

```
       [● symbol — lime shield icon 32px]

                MyVPN               ← Instrument Serif italic, 56px
         Your secure connection     ← Sans 14px muted

         ┌───────────────────┐
         │                   │
         │    [ QR 260x260 ] │      ← black QR on surface-sunken
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
         ▾ Advanced (individual keys)   ← Collapsible

         ───────────────────────────

         [Reset my link]  ← ghost small
```

### Details

- **Hero** — `MyVPN` in Instrument Serif italic, slight tilt. Subtitle — Sans.
- **QR card** — `bg-surface` with 24px inner padding. QR generated by backend with lime corner eye-pattern (optional, via query parameter).
- **Copy button** — `size="lg"` full-width, default variant (lime), with `Link2` icon.
- **Usage bar** — custom `<TrafficBar>`: lime fill → amber at > 70% → destructive at > 90%. Mount animation: width slides from 0 to target 600ms ease-out.
- **Expiry** — large text "12 days left", subtitle with date. When < 3 days — warning color.
- **Client buttons** — Card-like with client icon on the left (not Lucide, but client favicons — Streisand, Hiddify, etc., stored locally as SVG), name in the center, `ChevronRight` on the right. Tap → deep link.
- **"How to connect?" accordion** — 3 sections (iOS / Android / Desktop) with step-by-step instructions and screenshots.
- **"Advanced" collapsible** — three mini-QRs for VLESS and Hysteria 2 separately, with labels in mono font.

### Light theme for subscription

- Background `#FAF8F4` (warm off-white).
- Serif stays Instrument.
- Lime muted to `#84B800`.
- QR — white background.
- Warmer, more lamp-lit — for that "product" feel.

---

## 12. Empty States, Loading, Errors

### Empty state

Never a blank screen. Always:

```
       [icon 48px, muted]

       No users yet
       Create your first user to get started

       [+ Create user]
```

- Illustration — large Lucide icon at 0.4 opacity.
- Heading — 18px semibold.
- Description — 13px muted.
- CTA — primary button.

### Loading

- **Skeleton** for anything list-like (tables, dashboard cards).
- **Spinner** (Loader2 icon rotating) only inside buttons during mutations.
- **Top progress bar** (nprogress style, lime, 2px) for route navigation.

Skeleton pattern:

```tsx
<Skeleton className="h-4 w-32" />       // text
<Skeleton className="h-20 w-full" />    // card
<Skeleton className="h-9 w-24 rounded-md" />  // button
```

Shimmer effect — linear-gradient 90deg with `skeleton-shimmer` keyframe.

### Error states

| Situation | Display |
|-----------|---------|
| API 401 | Redirect → `/login` |
| API 404 on `/sub/:token` | Dedicated page "This link is no longer valid" |
| API 500 in admin | Toast with text + Retry button |
| Network error | Toast "Connection lost. Retrying..." with auto-retry |
| Form validation | Inline below field, destructive color, `AlertCircle` icon |
| Destructive confirmation | AlertDialog, red primary action |

Messages come from the `humanizeError` dictionary — never show raw stack traces.

---

## 13. Responsive Behavior

### Admin

- **< 768px (mobile)** — read-only. Show Dashboard and UsersPage list only. Config editing and user creation show "Please use desktop" with illustration.
- **768-1024px (tablet)** — works, but sidebar collapsed by default, some table columns hidden.
- **> 1024px (desktop)** — full functionality.

### Subscription page

- **< 360px** — QR shrinks to 220px, layout adapts.
- **360-768px** — primary target, max width 480px.
- **> 768px** — stays 480px centered, decorative background added to the sides (grid pattern or subtle gradient).

### Touch vs mouse

- Touch — hit targets minimum 44px.
- Hover states hidden on touch devices (via `@media (hover: hover)`).

---

## 14. tailwind.config and global.css

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
    /* (all variables from section 3) */
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

  /* custom scrollbar */
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

## Pre-development UI checklist

- [ ] Fonts (Geist, Instrument Serif, JetBrains Mono) loaded in `index.html` with `preconnect`.
- [ ] CSS variables from section 3 copied into `global.css`.
- [ ] `tailwind.config.ts` configured with custom colors, fonts, keyframes.
- [ ] Shadcn initialized with `darkMode: class`, base color neutral.
- [ ] All critical shadcn components installed (section 5).
- [ ] Lucide-react installed.
- [ ] `prefers-reduced-motion` handled globally.
- [ ] Custom components (`StatusBadge`, `TrafficBar`, `CopyButton`, `MonoField`, `MetricCard`, `DurationBadge`) implemented as base blocks.
- [ ] Layout from sidebar-07 adapted to our routes and icons.
- [ ] Theme provider: admin forces dark, subscription page follows system preference.

---

## Summary

The design language: **dark minimal + electric lime accent + Geist / Instrument Serif / JetBrains Mono**. Dense admin for engineering work, airy subscription page with a serif hero for end users. One bold accent that appears only in key moments. No stock AI visuals.

Together with SPEC.md, this is enough for an agent to build a complete product without guessing visual decisions.
