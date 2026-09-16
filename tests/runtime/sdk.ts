// Test-only dependency boundary. Production uses the platform SDK.
export const db = { list: async (..._args: unknown[]) => ({ items: [], nextToken: undefined }), add: async (..._args: unknown[]) => [], update: async (..._args: unknown[]) => [] };
export const router = (routes: unknown) => routes;
export const requireAuth = () => 'APPDEPLOY_AUTH_REQUIRED';
export const json = (data: unknown, statusCode = 200) => ({ statusCode, body: JSON.stringify(data) });
export const error = (message: string, statusCode = 500) => json({ error: message }, statusCode);
