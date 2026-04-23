export type ApiEnvelope<T> = {
  data: T;
  meta?: Record<string, unknown>;
};

export type ApiErrorShape = {
  error?: {
    code?: string;
    message?: string;
  };
};

export type UserStatus = 'active' | 'disabled' | 'expired' | 'limited';

export type User = {
  id: string;
  username: string;
  traffic_limit: number;
  traffic_used: number;
  expires_at: string | null;
  status: UserStatus;
  note: string;
  created_at: string;
};

export type UserLinks = {
  subscription: string;
  vless: string;
  hysteria2: string;
  qr: {
    subscription: string;
    vless: string;
    hysteria2: string;
  };
  usage: {
    traffic_limit: number;
    traffic_used: number;
    expires_at: string | null;
    status: UserStatus;
  };
  username: string;
};

export type TrafficPoint = {
  recorded_at: string;
  uplink: number;
  downlink: number;
};

export type OverviewStats = {
  active_users: number;
  expired_users: number;
  limited_users: number;
  disabled_users: number;
  today_traffic: number;
  cpu_usage_percent: number;
  memory_usage_percent: number;
  xray_status: string;
  hysteria_status: string;
  online_users: Array<{ username: string; recorded_at: string; bytes: number }>;
};

export type Setting = {
  key: string;
  value: unknown;
  updated_at: string;
};

export type AuditEntry = {
  id: number;
  admin_id?: string | null;
  action: string;
  target_type: string;
  target_id: string;
  ip: string;
  user_agent: string;
  created_at: string;
  metadata: unknown;
};

export type Admin = {
  id: string;
  username: string;
  role: string;
  created_at: string;
  last_login_at?: string | null;
};
