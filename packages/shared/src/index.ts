export type ApiError = {
  code: string;
  message: string;
  details?: readonly { field?: string; message: string }[];
};

export type HealthStatus = { status: 'ok' };
