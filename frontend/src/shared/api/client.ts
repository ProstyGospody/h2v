import { Admin, ApiEnvelope, ApiErrorShape } from '@/shared/api/types';

export class ApiError extends Error {
  constructor(
    public code: string | undefined,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

class ApiClient {
  private accessToken: string | null = null;
  private unauthorizedHandler: (() => void) | null = null;

  setAccessToken(token: string | null) {
    this.accessToken = token;
  }

  setUnauthorizedHandler(handler: (() => void) | null) {
    this.unauthorizedHandler = handler;
  }

  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const payload = await this.requestEnvelope<T>(path, init);
    return payload.data;
  }

  async requestEnvelope<T, M = Record<string, unknown>>(path: string, init?: RequestInit): Promise<ApiEnvelope<T, M>> {
    const target = path.startsWith('/sub/') ? path : `/api${path}`;
    const response = await fetch(target, {
      ...init,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
        ...init?.headers,
      },
    });

    if (response.status === 401 && path !== '/auth/refresh' && this.accessToken) {
      const refreshed = await this.refresh();
      if (refreshed) {
        return this.requestEnvelope<T, M>(path, init);
      }
    }

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as ApiErrorShape;
      throw new ApiError(body.error?.code, body.error?.message ?? 'Request failed', response.status);
    }

    const payload = (await response.json()) as ApiEnvelope<T, M> | T;
    if (payload && typeof payload === 'object' && 'data' in (payload as ApiEnvelope<T>)) {
      return payload as ApiEnvelope<T, M>;
    }
    return { data: payload as T };
  }

  async refresh(): Promise<{ access_token: string; admin: Admin } | null> {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      this.clearSession();
      return null;
    }
    const payload = (await response.json()) as ApiEnvelope<{ access_token: string; admin: Admin }>;
    this.accessToken = payload.data.access_token;
    return payload.data;
  }

  private clearSession() {
    this.accessToken = null;
    this.unauthorizedHandler?.();
  }
}

export const apiClient = new ApiClient();
