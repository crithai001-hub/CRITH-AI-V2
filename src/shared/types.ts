export type AuthTokens = {
  access_token: string
  refresh_token: string
  /** Unix timestamp in seconds. */
  expires_at: number
}
