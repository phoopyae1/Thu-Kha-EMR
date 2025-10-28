export interface AxiosRequestConfig {
  headers?: Record<string, string | undefined>;
}

export interface AxiosResponse<T = unknown> {
  data: T;
  status: number;
  statusText: string;
  headers: Headers;
}

export interface AxiosError<T = unknown> extends Error {
  isAxiosError: true;
  response?: AxiosResponse<T>;
  config?: AxiosRequestConfig;
}

function normalizeHeaders(headers?: Record<string, string | undefined>) {
  if (!headers) {
    return undefined;
  }

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      normalized[key] = value;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function buildHeaders(config?: AxiosRequestConfig) {
  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  const customHeaders = normalizeHeaders(config?.headers);
  if (customHeaders) {
    for (const [key, value] of Object.entries(customHeaders)) {
      headers.set(key, value);
    }
  }
  return headers;
}

async function toAxiosResponse<T>(response: Response): Promise<AxiosResponse<T>> {
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = text as T;
    }
  }

  return {
    data: data as T,
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  };
}

async function post<T = unknown, R = AxiosResponse<T>>(
  url: string,
  data?: unknown,
  config?: AxiosRequestConfig,
): Promise<R> {
  const headers = buildHeaders(config);
  const customHeaders = normalizeHeaders(config?.headers);
  const body = data instanceof FormData || data instanceof URLSearchParams ? data : data === undefined ? undefined : JSON.stringify(data);

  const response = await fetch(url, {
    method: 'POST',
    headers: data instanceof FormData || data instanceof URLSearchParams ? customHeaders : headers,
    body,
  });

  const axiosResponse = await toAxiosResponse<T>(response);

  if (!response.ok) {
    const error: AxiosError<T> = Object.assign(new Error(response.statusText || 'Request failed'), {
      isAxiosError: true as const,
      response: axiosResponse,
      config,
    });
    throw error;
  }

  return axiosResponse as R;
}

function isAxiosError<T = unknown>(value: unknown): value is AxiosError<T> {
  return typeof value === 'object' && value !== null && (value as Partial<AxiosError>).isAxiosError === true;
}

const axios = {
  post,
  isAxiosError,
};

export default axios;
