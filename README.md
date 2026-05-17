<p align="center">
  <img src="frontend/public/logo.svg" alt="h2v" width="156">
</p>

<h1 align="center">h2v</h1>

<p align="center">
  A clean self-hosted VPN panel for Xray VLESS Reality and Hysteria 2.
</p>

<p align="center">
  <a href="#russian"><strong>Русский</strong></a>
  ·
  <a href="#english"><strong>English</strong></a>
</p>

<p align="center">
  <img alt="RU / EN interface" src="https://img.shields.io/badge/RU%20%2F%20EN-interface-8b5cf6?style=for-the-badge">
  <img alt="Ubuntu 22.04 / 24.04" src="https://img.shields.io/badge/Ubuntu-22.04%20%2F%2024.04-f97316?style=for-the-badge">
  <img alt="VLESS Reality" src="https://img.shields.io/badge/VLESS-Reality-06b6d4?style=for-the-badge">
  <img alt="Hysteria 2" src="https://img.shields.io/badge/Hysteria-2-22c55e?style=for-the-badge">
</p>

---

<a id="russian"></a>

## Русский

**h2v** - это приватная веб-панель для своего VPN-сервера. Она помогает управлять пользователями, подписками, трафиком, резервными копиями и состоянием сервисов из одного места.

### Быстрая установка

```bash
curl -fsSL https://raw.githubusercontent.com/ProstyGospody/h2v/main/install.sh | sudo bash
```

Установщик спросит язык, домен, публичные порты и данные администратора. Для русского интерфейса без вопроса о языке:

```bash
curl -fsSL https://raw.githubusercontent.com/ProstyGospody/h2v/main/install.sh | sudo env H2V_LANG=ru bash
```

### Перед установкой

Нужен чистый сервер Ubuntu 22.04 или 24.04.

Лучше заранее направить домен на IP сервера. Тогда панель откроется по HTTPS, а Hysteria 2 сможет использовать сертификат автоматически.

### Что сделает мастер

| Шаг | Что увидит пользователь |
| --- | --- |
| Настройка | Выбор языка, домена, портов и администратора. |
| Установка | Подготовка панели, базы данных, Xray и Hysteria 2. |
| Запуск | Автозапуск сервисов, HTTPS и обновление маршрутных данных. |
| Финал | Адрес панели, логин, пароль и полезные действия. |

При обновлении текущие секреты не перезаписываются. Если настройки уже есть, мастер предложит оставить их или изменить домен и публичные порты.

### После установки

Откройте адрес панели, который покажет мастер, войдите под администратором и создайте пользователей. Сохраните пароль администратора сразу: автоматически созданный пароль показывается один раз.

### Полезные действия

```bash
/opt/h2v/install.sh update
/opt/h2v/install.sh geodata
/opt/h2v/install.sh reset-admin
/opt/h2v/install.sh backup
```

---

<a id="english"></a>

## English

**h2v** is a private web panel for your own VPN server. It keeps users, subscriptions, traffic, backups, and service status in one focused interface.

### Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/ProstyGospody/h2v/main/install.sh | sudo bash
```

The installer asks for language, domain, public ports, and admin access. To force English without the language prompt:

```bash
curl -fsSL https://raw.githubusercontent.com/ProstyGospody/h2v/main/install.sh | sudo env H2V_LANG=en bash
```

### Before You Start

Use a fresh Ubuntu 22.04 or 24.04 server.

Point a real domain to the server first if possible. This lets the panel open over HTTPS and lets Hysteria 2 use the certificate automatically.

### What The Installer Does

| Step | What you get |
| --- | --- |
| Setup | Language, domain, ports, and admin access prompts. |
| Install | Panel, database, Xray, and Hysteria 2 prepared. |
| Start | Autostart, HTTPS, and routing-data updates configured. |
| Finish | Panel URL, login, password, and useful actions. |

Existing secrets are not overwritten during updates. If settings already exist, the installer lets you keep them or change the domain and public ports.

### After Install

Open the panel URL shown by the installer, sign in as admin, and create users. Save the admin password immediately: an auto-generated password is shown once.

### Useful Actions

```bash
/opt/h2v/install.sh update
/opt/h2v/install.sh geodata
/opt/h2v/install.sh reset-admin
/opt/h2v/install.sh backup
```
