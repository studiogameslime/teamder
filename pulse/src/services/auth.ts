// Legacy call-site adapters. These are inert labels, NEVER provider tokens.
// adminTransport authenticates the person; the server selects the upstream.
export function appStoreJwt(): string { return 'server-managed'; }
export async function googleAccessToken(_scope: string): Promise<string> { return 'server-managed'; }
export async function googleOAuthToken(): Promise<string> { return 'server-managed'; }
