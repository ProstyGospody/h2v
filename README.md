<p align="center">
  <img src="frontend/public/logo.svg" alt="h2v" width="168">
</p>

<h1 align="center">h2v</h1>

<p align="center">
  Minimal self-hosted VPN panel for Xray VLESS Reality and Hysteria 2.
</p>

<p align="center">
  <a href="#english">English</a>
  ·
  <a href="#russian">Русский</a>
</p>

<p align="center">
  <a href="https://github.com/XTLS/Xray-core">
    <img src="frontend/public/cores/xray.svg" alt="Xray" height="32">
  </a>
  &nbsp;&nbsp;
  <a href="https://github.com/apernet/hysteria">
    <img src="frontend/public/cores/hysteria2.svg" alt="Hysteria 2" height="32">
  </a>
</p>

## Quick Start

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/ProstyGospody/h2v/main/install.sh)
```

---

<a id="english"></a>

## English

### Overview

**h2v** is a private dashboard for managing a small VPN node. It combines user management, subscriptions, traffic visibility, and core configuration in one panel.

### Highlights

- Users, traffic limits, expiration dates, and status control.
- Subscription links, QR codes, and a public user page.
- Automatic config rendering for Xray VLESS Reality and Hysteria 2.
- Dashboard with traffic, uptime, and service health.
- Panel settings for domains, ports, Reality keys, Hysteria options, backups, and geodata.

### Built Around

| Core | Project |
| --- | --- |
| <img src="frontend/public/cores/xray.svg" alt="Xray" height="22"> Xray | [XTLS/Xray-core](https://github.com/XTLS/Xray-core) |
| <img src="frontend/public/cores/hysteria2.svg" alt="Hysteria 2" height="22"> Hysteria 2 | [apernet/hysteria](https://github.com/apernet/hysteria) |

### Intended Use

h2v is designed for a fresh Ubuntu server with a real domain pointed to it. The installer sets up the panel, backend, frontend, database, systemd services, Xray, and Hysteria 2.

---

<a id="russian"></a>

## Русский

### Обзор

**h2v** - приватный дашборд для управления небольшим VPN-сервером. Панель объединяет пользователей, подписки, трафик и конфигурацию cores в одном интерфейсе.

### Возможности

- Пользователи, лимиты трафика, сроки действия и управление статусом.
- Ссылки подписки, QR-коды и публичная страница пользователя.
- Автоматическая генерация конфигов для Xray VLESS Reality и Hysteria 2.
- Дашборд с трафиком, uptime и состоянием сервисов.
- Настройки доменов, портов, Reality-ключей, Hysteria, бэкапов и geodata.

### Основано На

| Core | Проект |
| --- | --- |
| <img src="frontend/public/cores/xray.svg" alt="Xray" height="22"> Xray | [XTLS/Xray-core](https://github.com/XTLS/Xray-core) |
| <img src="frontend/public/cores/hysteria2.svg" alt="Hysteria 2" height="22"> Hysteria 2 | [apernet/hysteria](https://github.com/apernet/hysteria) |

### Для Чего

h2v рассчитан на чистый Ubuntu-сервер с реальным доменом, направленным на сервер. Installer настраивает панель, backend, frontend, базу данных, systemd-сервисы, Xray и Hysteria 2.
