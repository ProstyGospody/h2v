<p align="center">
  <img src="frontend/public/logo.svg" alt="h2v" width="172">
</p>

<h1 align="center">h2v</h1>

<p align="center">
  A clean self-hosted VPN panel for Xray VLESS Reality and Hysteria 2.
</p>

<p align="center">
  <a href="#english">English</a>
  ·
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

## Install

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/ProstyGospody/h2v/main/install.sh)
```

---

## English

**h2v** is a private web panel for running a small VPN server. It gives you one place to manage users, subscriptions, traffic, service status, and protocol settings.

### What It Does

- Creates and manages VPN users.
- Tracks traffic usage, limits, and expiration dates.
- Generates subscription links and QR codes.
- Renders configs for Xray VLESS Reality and Hysteria 2.
- Shows traffic, uptime, and service health on the dashboard.
- Keeps panel settings, backups, geodata, and core options in the UI.

### Supported Cores

<p>
  <a href="https://github.com/XTLS/Xray-core">
    <img src="frontend/public/cores/xray.svg" alt="Xray" height="24">
  </a>
  &nbsp;
  <strong>Xray-core</strong> - VLESS Reality support.
</p>

<p>
  <a href="https://github.com/apernet/hysteria">
    <img src="frontend/public/cores/hysteria2.svg" alt="Hysteria 2" height="24">
  </a>
  &nbsp;
  <strong>Hysteria 2</strong> - fast QUIC-based transport.
</p>

### Built For

h2v is intended for a fresh Ubuntu server with a domain pointed to it. The installer prepares the panel, backend, frontend, database, services, Xray, and Hysteria 2.

---

<a id="russian"></a>

## Русский

**h2v** - приватная веб-панель для небольшого VPN-сервера. В одном интерфейсе собраны пользователи, подписки, трафик, состояние сервисов и настройки протоколов.

### Что Умеет

- Создает VPN-пользователей и помогает управлять ими.
- Показывает расход трафика, лимиты и сроки действия.
- Генерирует ссылки подписки и QR-коды.
- Собирает конфиги для Xray VLESS Reality и Hysteria 2.
- Показывает трафик, uptime и состояние сервисов на дашборде.
- Позволяет менять настройки панели, резервных копий, geodata и ядер через интерфейс.

### Поддерживаемые Ядра

<p>
  <a href="https://github.com/XTLS/Xray-core">
    <img src="frontend/public/cores/xray.svg" alt="Xray" height="24">
  </a>
  &nbsp;
  <strong>Xray-core</strong> - поддержка VLESS Reality.
</p>

<p>
  <a href="https://github.com/apernet/hysteria">
    <img src="frontend/public/cores/hysteria2.svg" alt="Hysteria 2" height="24">
  </a>
  &nbsp;
  <strong>Hysteria 2</strong> - быстрый транспорт на базе QUIC.
</p>

### Для Чего

h2v рассчитан на чистый Ubuntu-сервер с доменом, направленным на него. Установщик подготавливает панель, серверную часть, веб-интерфейс, базу данных, сервисы, Xray и Hysteria 2.
