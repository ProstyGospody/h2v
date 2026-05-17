<p align="center">
  <img src="frontend/public/logo.svg" alt="h2v" width="168">
</p>

<h1 align="center">h2v</h1>

<p align="center">
  <strong>Self-hosted web panel for VLESS Reality and Hysteria 2</strong>
</p>

<p align="center">
  Manage users, subscriptions, traffic, service health, backups, and routing data from one clean interface.
</p>

<p align="center">
  <a href="#russian"><strong>Русский</strong></a>
  <span> / </span>
  <a href="#english"><strong>English</strong></a>
</p>

<p align="center">
  <img alt="Interface language" src="https://img.shields.io/badge/interface-RU%20%2F%20EN-8b5cf6?style=for-the-badge">
  <img alt="Ubuntu" src="https://img.shields.io/badge/Ubuntu-22.04%20%2F%2024.04-f97316?style=for-the-badge">
  <img alt="VLESS Reality" src="https://img.shields.io/badge/VLESS-Reality-06b6d4?style=for-the-badge">
  <img alt="Hysteria 2" src="https://img.shields.io/badge/Hysteria-2-22c55e?style=for-the-badge">
</p>

<p align="center">
  <a href="https://github.com/XTLS/Xray-core">
    <img alt="Xray-core" src="frontend/public/cores/xray.svg" height="34">
  </a>
  &nbsp;&nbsp;
  <a href="https://github.com/apernet/hysteria">
    <img alt="Hysteria 2" src="frontend/public/cores/hysteria2.svg" height="34">
  </a>
</p>

---

<a id="russian"></a>

## Русский

**h2v** - веб-панель для управления двумя прокси-протоколами: **VLESS Reality** на базе Xray-core и **Hysteria 2**. Панель рассчитана на личный сервер и помогает быстро выдавать доступ, следить за трафиком и обслуживать установку без ручной работы в конфигурационных файлах.

### Установка

```bash
curl -fsSL https://raw.githubusercontent.com/ProstyGospody/h2v/main/install.sh | sudo bash
```

Запуск сразу на русском:

```bash
curl -fsSL https://raw.githubusercontent.com/ProstyGospody/h2v/main/install.sh | sudo env H2V_LANG=ru bash
```

### Что внутри

| Управление | Протоколы | Обслуживание |
| --- | --- | --- |
| Пользователи, лимиты, сроки действия, отключение доступа. | VLESS Reality TCP и Hysteria 2 UDP с отдельными публичными портами. | Обновление GeoIP/Geosite, резервные копии, состояние сервисов. |

| Подписки | Панель | Установка |
| --- | --- | --- |
| Ссылки, QR-коды и страницы пользователей для клиентских приложений. | Минималистичный интерфейс для ежедневного управления. | Мастер на русском и английском, без перезаписи существующих секретов. |

### Перед запуском

| Нужно | Почему |
| --- | --- |
| Ubuntu 22.04 или 24.04 | Установщик готовит пакеты, сервисы и автозапуск под Ubuntu. |
| Домен, направленный на сервер | Панель сможет открываться по HTTPS, а Hysteria 2 получит сертификат. |
| Root-доступ | Установщик создаёт сервисы, пользователей, директории и системные unit-файлы. |

### После установки

Мастер покажет адрес панели, логин и пароль администратора. Если пароль создан автоматически, сохраните его сразу: повторно он не выводится.

```bash
/opt/h2v/install.sh update
/opt/h2v/install.sh geodata
/opt/h2v/install.sh reset-admin
/opt/h2v/install.sh backup
```

### Поддерживаемые клиенты

<p>
  <img alt="Hiddify" src="frontend/public/clients/hiddify.svg" height="28">
  &nbsp;
  <img alt="v2rayNG" src="frontend/public/clients/v2rayng.svg" height="28">
  &nbsp;
  <img alt="Shadowrocket" src="frontend/public/clients/shadowrocket.svg" height="28">
  &nbsp;
  <img alt="Streisand" src="frontend/public/clients/streisand.svg" height="28">
  &nbsp;
  <img alt="Karing" src="frontend/public/clients/karing.svg" height="28">
</p>

---

<a id="english"></a>

## English

**h2v** is a web panel for managing two proxy protocols: **VLESS Reality** powered by Xray-core and **Hysteria 2**. It is designed for a personal server and keeps access management, traffic visibility, and maintenance actions in one focused interface.

### Install

```bash
curl -fsSL https://raw.githubusercontent.com/ProstyGospody/h2v/main/install.sh | sudo bash
```

Run directly in English:

```bash
curl -fsSL https://raw.githubusercontent.com/ProstyGospody/h2v/main/install.sh | sudo env H2V_LANG=en bash
```

### What You Get

| Management | Protocols | Maintenance |
| --- | --- | --- |
| Users, limits, expiration dates, and access control. | VLESS Reality TCP and Hysteria 2 UDP on separate public ports. | GeoIP/Geosite updates, backups, and service health. |

| Subscriptions | Panel | Installer |
| --- | --- | --- |
| Links, QR codes, and user pages for client apps. | Minimal interface for daily operation. | Russian and English wizard that preserves existing secrets. |

### Before You Start

| Requirement | Reason |
| --- | --- |
| Ubuntu 22.04 or 24.04 | The installer prepares packages, services, and autostart for Ubuntu. |
| Domain pointed to the server | The panel can open over HTTPS and Hysteria 2 can use the certificate. |
| Root access | The installer creates services, users, directories, and systemd units. |

### After Install

The installer prints the panel address, admin login, and admin password. If the password is generated automatically, save it immediately: it is shown once.

```bash
/opt/h2v/install.sh update
/opt/h2v/install.sh geodata
/opt/h2v/install.sh reset-admin
/opt/h2v/install.sh backup
```

### Supported Clients

<p>
  <img alt="Hiddify" src="frontend/public/clients/hiddify.svg" height="28">
  &nbsp;
  <img alt="v2rayNG" src="frontend/public/clients/v2rayng.svg" height="28">
  &nbsp;
  <img alt="Shadowrocket" src="frontend/public/clients/shadowrocket.svg" height="28">
  &nbsp;
  <img alt="Streisand" src="frontend/public/clients/streisand.svg" height="28">
  &nbsp;
  <img alt="Karing" src="frontend/public/clients/karing.svg" height="28">
</p>
