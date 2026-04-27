# Cookie rotation flow with n8n

This API supports cookie rotation through:
- `POST /api/admin/cookies/replace`
- Bearer token auth via `COOKIE_ADMIN_TOKEN`
- Raw Netscape cookies file upload

## Recommended flow

1. Frontend uploads `cookies.txt` to an authenticated n8n webhook.
2. n8n forwards the binary payload to this API endpoint.
3. API validates and atomically replaces cookie file.
4. API appends one JSON audit line with result metadata.
5. n8n returns success/error payload to frontend.

## n8n HTTP Request node settings

- Method: `POST`
- URL: `https://<your-api-host>/api/admin/cookies/replace`
- Send body as: `Raw` (binary/text as-is)
- Content-Type: `text/plain` (or `application/octet-stream`)
- Headers:
  - `Authorization: Bearer <COOKIE_ADMIN_TOKEN>`
  - `x-cookie-actor: n8n:<workflow-name>`

## Expected success payload

```json
{
  "ok": true,
  "bytes": 873,
  "cookiesParsed": 12,
  "sha256": "f20f04ed8f9fbc8f9ee6f736f8f7f931d5c7dbaadfcb93f4a4d4e75fc2eeb9d2",
  "updatedAt": "2026-04-27T20:45:00.000Z"
}
```

## Error mapping suggestion for frontend UX

- `401` / `403`: auth issue, prompt admin to refresh credentials.
- `400`: invalid cookies file format.
- `413`: file too large.
- `500`: write/audit operational issue, retry and notify admin.
- `503`: endpoint disabled (missing `COOKIE_ADMIN_TOKEN`).
