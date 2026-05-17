<p align="center">
  <img src="frontend/public/logo.svg" alt="h2v" width="176">
</p>

<h1 align="center">h2v</h1>

<p align="center">
  A compact self-hosted VPN panel for Xray VLESS Reality and Hysteria 2.
</p>

<p align="center">
  <a href="#english">English</a>
  &nbsp;|&nbsp;
  <a href="#russian">Русский</a>
</p>

<p align="center">
  <a href="https://github.com/XTLS/Xray-core">
    <img src="frontend/public/cores/xray.svg" alt="Xray" height="34">
  </a>
  &nbsp;&nbsp;&nbsp;
  <a href="https://github.com/apernet/hysteria">
    <img src="frontend/public/cores/hysteria2.svg" alt="Hysteria 2" height="34">
  </a>
</p>

<p align="center">
  <strong>Launch command</strong>
</p>

<p align="center">
  <code>bash &lt;(curl -fsSL https://raw.githubusercontent.com/ProstyGospody/h2v/main/install.sh)</code>
</p>

---

<a id="english"></a>

## English

**h2v** is a private control panel for a small self-hosted VPN server. It helps manage users, subscriptions, traffic, and core configuration from one dashboard.

### What It Includes

- User management with traffic limits and expiration dates.
- Subscription links, QR codes, and a public user portal.
- Automatic config rendering for Xray VLESS Reality and Hysteria 2.
- Dashboard with traffic, uptime, and service status.
- Settings for ports, domains, Reality keys, Hysteria options, backups, and geodata.

### Core Projects

| Project | Role |
| --- | --- |
| <img src="frontend/public/cores/xray.svg" alt="Xray" height="22"> [Xray-core](https://github.com/XTLS/Xray-core) | VLESS Reality core |
| <img src="frontend/public/cores/hysteria2.svg" alt="Hysteria 2" height="22"> [Hysteria 2](https://github.com/apernet/hysteria) | QUIC-based Hysteria core |

### Notes

Designed for a fresh Ubuntu server with a real domain pointed to it. The installer configures the panel, backend, frontend, database, systemd services, Xray, and Hysteria 2.

---

<a id="russian"></a>

## Русский

**h2v** - приватная панель управления для небольшого self-hosted VPN-сервера. Она помогает управлять пользователями, подписками, трафиком и конфигурацией cores из одного дашборда.

### Что Внутри

- Управление пользователями, лимитами трафика и сроками действия.
- Ссылки подписки, QR-коды и публичная страница пользователя.
- Автоматическая генерация конфигов для Xray VLESS Reality и Hysteria 2.
- Дашборд с трафиком, uptime и статусом сервисов.
- Настройки портов, доменов, Reality-ключей, Hysteria, бэкапов и geodata.

### Проекты

| Проект | Роль |
| --- | --- |
| <img src="frontend/public/cores/xray.svg" alt="Xray" height="22"> [Xray-core](https://github.com/XTLS/Xray-core) | Core для VLESS Reality |
| <img src="frontend/public/cores/hysteria2.svg" alt="Hysteria 2" height="22"> [Hysteria 2](https://github.com/apernet/hysteria) | QUIC-based core Hysteria |

### Заметки

Панель рассчитана на чистый Ubuntu-сервер с реальным доменом, направленным на сервер. Installer настраивает панель, backend, frontend, базу данных, systemd-сервисы, Xray и Hysteria 2.
