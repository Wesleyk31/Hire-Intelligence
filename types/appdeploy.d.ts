// SDK type contracts retrieved from the official AppDeploy connector, 2026-09-16.
// Runtime packages are injected by AppDeploy; these declarations do not emulate them.
declare module '@appdeploy/client' {
/**
 * HTTP client for backend API calls. Works like axios.
 *
 * @example
 * ```typescript
 * import { api } from '@appdeploy/client';
 *
 * api.get('/api/items')                      // GET all items
 * api.get('/api/items/123')                  // GET single item
 * api.post('/api/items', { name: 'New' })    // POST create item
 * api.put('/api/items/123', { name: 'Upd' }) // PUT update item
 * api.delete('/api/items/123')               // DELETE item
 * ```
 */
export interface Api {
    get(url: string, data?: any): Promise<{ data: any }>;
    post(url: string, data?: any): Promise<{ data: any }>;
    put(url: string, data?: any): Promise<{ data: any }>;
    delete(url: string, data?: any): Promise<{ data: any }>;
}

export type ApiAPI = Api;

export const api: Api;
/** Authenticated user information */
export interface AuthUser {
    /** Stable AppDeploy user ID (UUID) */
    userId: string;
    /** User's email address (requires 'email' scope) */
    email?: string;
    /** User's display name (requires 'profile' scope) */
    name?: string;
    /** User's profile picture URL (requires 'profile' scope) */
    picture?: string;
    /** Space-separated list of granted scopes */
    scope: string;
}

/** Sign-in options */
export interface SignInOptions {
    /** Space-separated list of scopes to request (default: "openid email profile offline_access") Do not include 'offline_access' if you intentionally do not want refresh tokens. */
    scope?: string;
}

/** Sign-in result */
export interface SignInResult {
    /** The authenticated user */
    user: AuthUser;
    /** Access token (automatically attached to API requests) */
    accessToken: string;
    /** Token expiration time in seconds */
    expiresIn: number;
}

/** Authentication API */
export interface AuthAPI {
    /**
     * Opens a popup for user sign-in.
     * Returns the authenticated user on success, or throws on failure/cancel.
     * Error codes: 'popup_blocked' (browser blocked the popup), 'popup_closed' (user closed before completing), 'auth_error' (authentication failed).
     */
    signIn(options?: SignInOptions): Promise<SignInResult>;

    /**
     * Gets the currently authenticated user, or null if not signed in.
     * Automatically refreshes expired access tokens if a refresh token exists.
     */
    getUser(): Promise<AuthUser | null>;

    /**
     * Gets the current access token, or null if not signed in.
     * Automatically refreshes expired tokens if a refresh token exists.
     */
    getAccessToken(): Promise<string | null>;

    /**
     * Signs out the current user and clears stored tokens.
     */
    signOut(): Promise<void>;

    /**
     * Returns true if the user is signed in (has a valid or refreshable token).
     */
    isSignedIn(): boolean;
}

export const auth: AuthAPI;

export interface WsConnection {
    connectionId: string | null;
    ready: Promise<void>;
    onMessage(fn: (message: any) => void): void;
    onOpen(fn: () => void): void;
    onClose(fn: () => void): void;
    onError(fn: (err: any) => void): void;
    disconnect(): void;
}

/**
 * WebSocket client for real-time entity updates.
 * API shape note: ws exposes connect() only.
 * Do NOT call ws.subscribe(), ws.publish(), ws.send(), or ws.onMessage() directly on ws.
 *
 * @example
 * ```typescript
 * import { api, ws } from '@appdeploy/client';
 *
 * const conn = ws.connect();
 * conn.onMessage(msg => console.log(msg));
 * conn.ready.then(() => {
 *   const connection_id = conn.connectionId;
 *   // Subscribe to entity updates via backend route
 *   api.post('/api/subscriptions', { entity_type: 'room', entity_id: 'room-1', connection_id });
 * });
 * // On cleanup: conn.disconnect();
 * ```
 */
export interface WsAPI {
    connect(options?: { appId?: string; app_id?: string; heartbeatIntervalMs?: number }): WsConnection;
}

export const ws: WsAPI;
}
declare module '@appdeploy/sdk' {
export interface AuthUser {
    /** Stable AppDeploy user ID (UUID) */
    userId: string;
    /** User's email address (requires 'email' scope) */
    email?: string;
    /** User's display name (requires 'profile' scope) */
    name?: string;
    /** Space-separated list of granted scopes */
    scope: string;
}

// --- Router helpers ---

/** Context passed to each route middleware */
export interface RouterContext {
    /** Parsed request body */
    body: unknown;
    /** Query string parameters */
    query: Record<string, string>;
    /** URL path parameters (e.g., :id) */
    params: Record<string, string>;
    /** Raw Lambda event */
    event: any;
    /** Authenticated user (set by requireAuth middleware) */
    user?: AuthUser;
}

/** Standard JSON response returned by route handlers */
export interface RouterResponse {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
}

/** A route middleware function */
export type RouterMiddleware = (
    ctx: RouterContext
) => Promise<RouterResponse | void> | RouterResponse | void;

/** Route definitions: pattern string → middleware chain */
export type RouterRoutes = Record<string, RouterMiddleware[]>;

/**
 * Create a Lambda handler that routes requests through middleware chains.
 *
 * @example
 * ```typescript
 * import { router, json, error } from '@appdeploy/sdk';
 *
 * // Use SDK router/auth helpers directly. Do not re-implement custom router/requireAuth/json helpers.
 * // Reserved platform paths like __appdeploy/* are handled by the platform and should not be defined in app routes.
 *
 * export const handler = router({
 *   'GET /api/items': [async (ctx) => json(await getItems())],
 *   'POST /api/items': [async (ctx) => {
 *     const item = ctx.body as { name: string };
 *     return json({ created: true });
 *   }],
 *   'GET /api/items/:id': [async (ctx) => json({ id: ctx.params.id })],
 * });
 * ```
 */
export function router(
    routes: RouterRoutes
): (event: any) => Promise<RouterResponse>;

/** Create a JSON success response */
export function json(data: unknown, status?: number): RouterResponse;

/** Create a JSON error response */
export function error(message: string, status?: number): RouterResponse;

/**
 * Authentication - verify app user tokens and enforce scopes.
 *
 * The auth API verifies RS256 JWTs issued by AppDeploy's token exchange service.
 * Access tokens are short-lived (15 min) and contain user identity and granted scopes.
 *
 * @example
 * ```typescript
 * import { auth } from '@appdeploy/sdk';
 * import type { APIGatewayProxyEventV2 } from 'aws-lambda';
 *
 * export async function handler(event: APIGatewayProxyEventV2) {
 *   // Get authenticated user (returns null if no valid token)
 *   const user = await auth.getUser(event);
 *   if (!user) {
 *     return { statusCode: 401, body: 'Unauthorized' };
 *   }
 *
 *   // Check if user has email scope
 *   if (auth.hasScope(user, 'email') && user.email) {
 *     console.log(`User email: ${user.email}`);
 *   }
 *
 *   // Require profile scope or throw 403
 *   auth.requireScope(user, 'profile');
 *
 *   return { statusCode: 200, body: JSON.stringify({ userId: user.userId }) };
 * }
 * ```
 */
export interface AuthUser {
    /** Stable AppDeploy user ID (UUID) */
    userId: string;
    /** User's email address (requires 'email' scope) */
    email?: string;
    /** User's display name (requires 'profile' scope) */
    name?: string;
    /** Space-separated list of granted scopes */
    scope: string;
}

export const auth: {
    /**
     * Extracts and verifies the access token from the Authorization header.
     * Returns the authenticated user, or null if no valid token is present.
     *
     * @param event - Lambda event containing Authorization header
     * @returns The authenticated user, or null if not authenticated
     */
    getUser(event: { headers?: Record<string, string | undefined> }): Promise<AuthUser | null>;

    /**
     * Checks if the user has a specific scope.
     *
     * @param user - The authenticated user
     * @param scope - The scope to check (e.g., 'email', 'profile')
     * @returns True if the user has the scope
     */
    hasScope(user: AuthUser, scope: string): boolean;

    /**
     * Throws a 403 Forbidden error if the user doesn't have the required scope.
     *
     * @param user - The authenticated user
     * @param scope - The required scope
     * @throws Error with statusCode 403 if scope is missing
     */
    requireScope(user: AuthUser, scope: string): void;
};

// --- Auth middleware ---

/**
 * Middleware that verifies the user's auth token.
 * Sets ctx.user on success. Returns 401 if not authenticated.
 *
 * @example
 * ```typescript
 * import { router, json, requireAuth, withScopes, requireAdminEmailAllowlist } from '@appdeploy/sdk';
 *
 * const ADMIN_EMAILS = ['owner@your-company.com'];
 *
 * export const handler = router({
 *   'GET /api/profile': [requireAuth(), async (ctx) => json({ userId: ctx.user!.userId })],
 *   'GET /api/me-email': [requireAuth(), withScopes('email'), async (ctx) => json({ email: ctx.user!.email })],
 *   'GET /api/admin': [requireAuth(), requireAdminEmailAllowlist(ADMIN_EMAILS), async () => json({ ok: true })],
 * });
 * ```
 */
export function requireAuth(): RouterMiddleware;

/**
 * Middleware that checks the authenticated user has the specified scopes.
 * Must be used after requireAuth().
 */
export function withScopes(...scopes: string[]): RouterMiddleware;

/**
 * Middleware that restricts access to a list of admin email addresses.
 * Must be used after requireAuth().
 */
export function requireAdminEmailAllowlist(
    adminEmails: string[]
): RouterMiddleware;

/**
 * Database operations - key-value store with tables.
 * Each table is isolated per app. Records have auto-generated IDs.
 *
 * Keep reads bounded. Filters run after reads and do not reduce cost.
 * Per-app minute and daily quotas apply; never hide or retry 429 AppDatabaseQuotaExceeded.
 * Each complete serialized item, including nested data and keys, must be at most 256 KiB. Count
 * caps are not size checks; split by bytes or store large arrays and blobs in storage.
 * Every db.* call has a 1 MiB serialized-input limit. db.add, db.get, db.update, and db.delete
 * accept at most 500 array elements per call; split larger work by both byte size and item count.
 * Prefer db.get with saved IDs or bounded logical tables. Never drain all pages or rescan growing
 * tables in one request or cron.
 *
 * TIP: Use generic type parameters with db.get() and db.list() when you need typed access
 * to record properties (e.g., iterating over arrays, accessing nested fields).
 *
 * @example
 * ```typescript
 * import { db } from '@appdeploy/sdk';
 *
 * // Define your record types
 * interface User {
 *   name: string;
 *   email: string;
 *   role?: string;
 * }
 *
 * // Add records - returns array with ID (success) or null (failure) per record
 * const ids = await db.add('users', [
 *   { name: 'Alice', email: 'alice@example.com' },
 *   { name: 'Bob', email: 'bob@example.com' }
 * ]);
 * // Returns: ['uuid-1', 'uuid-2'] - both succeeded
 * // Or: ['uuid-1', null] - second record failed
 * // Filter successful IDs: const successIds = ids.filter(id => id !== null);
 *
 * // Get records by ID - use generic type for typed results
 * const [user] = await db.get<User>('users', ['uuid-1']);
 * if (user) {
 *   console.log(user.name); // TypeScript knows this is a string
 * }
 *
 * // List one bounded page - use generic type for typed results
 * const { items, nextToken } = await db.list<User>('users', { limit: 20 });
 * // items is typed as Array<User & { id: string }>
 * items.forEach(user => console.log(user.name, user.id));
 *
 * // Update records - replaces entire record, so fetch first to preserve fields
 * const [existing] = await db.get<User>('users', ['uuid-1']);
 * if (existing) {
 *   const [ok] = await db.update('users', [
 *     { id: 'uuid-1', record: { ...existing, name: 'Alice Smith' } }
 *   ]);
 *   // Returns: [true] - update succeeded, or [false] - update failed
 * }
 *
 * // Delete records - returns boolean array indicating success per record
 * const deleted = await db.delete('users', ['uuid-1', 'uuid-2']);
 * // Returns: [true, true] - both deleted
 * // Check: deleted.every(ok => ok) // all succeeded
 * ```
 */
export const db: {
    /** Add records to a table. Returns array with ID (success) or null (failure) per record */
    add(table: string, records: Array<Record<string, unknown>>): Promise<Array<string | null>>;

    /** Update existing records by ID (replaces entire record). Returns boolean array indicating success per record */
    update(
        table: string,
        items: Array<{ id: string; record: Record<string, unknown> }>
    ): Promise<boolean[]>;

    /** Get stored record data by ID, in request order. Does not attach IDs to returned records; retain and reuse the requested IDs. Returns null for missing records. Use generic for typed results; default Record<string, any> to avoid TS2488 when iterating/spreading. */
    get<T = Record<string, any>>(table: string, ids: string[]): Promise<Array<T | null>>;

    /** List one bounded page with an optional post-read filter. Use nextToken only when another page is needed. */
    list<T = Record<string, any>>(
        table: string,
        options?: { filter?: Record<string, unknown>; nextToken?: string; limit?: number }
    ): Promise<{
        items: Array<Omit<T, "id"> & { id: string }>;
        nextToken?: string;
    }>;

    /** Delete records by ID. Returns boolean array indicating success per record */
    delete(table: string, ids: string[]): Promise<boolean[]>;
};

/**
 * WebSocket send - deliver payload to one or more connection IDs.
 */
export const ws: {
    /**
     * Send a payload to one or more connection IDs.
     * Resolves when the platform accepts the delivery for asynchronous processing.
     */
    send(
        connection_id: string | string[],
        payload: unknown
    ): Promise<{
        ok: boolean;
        accepted?: boolean;
        send_id?: string;
        gone?: boolean;
        error?: string;
    }>;
};

}
