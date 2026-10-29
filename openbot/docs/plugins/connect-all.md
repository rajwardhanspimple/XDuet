# Connecting every plugin

This is the practical setup path for a local OpenDuet/OpenBot deployment. It covers the plugins
already in the catalogue and the broker path for apps outside it.

**Do not store anyone's Google, Notion, or other account password in this deployment.** The supported
path is OAuth: the vendor shows its own consent screen, this deployment stores an encrypted refresh
token, and each person can revoke access at the vendor. There is deliberately no endpoint for one
person's password or for an administrator to connect an account as somebody else.

## Current local URLs

| Service | URL |
| --- | --- |
| App | `http://localhost:3110` |
| API | `http://localhost:3101` |
| Plugin OAuth callback | `http://localhost:3101/api/plugins/oauth/callback` |

The exact callback string is also shown under **Connection** on each plugin page. Always copy it from
there rather than retyping it.

## What is already installed

These reviewed catalogue entries are added:

- Parallel Search
- Exa Search
- Firecrawl
- Google Drive
- Gmail and Google Calendar
- Notion
- Routines

Their tools are granted to OpenDuet. Writes still pass through the approval policy.

The three "API key" variants are not added because no Parallel, Exa, or Firecrawl key is configured.
The unauthenticated entries work without a key. Add a keyed variant only if you need higher limits.

## Google Drive and Gmail/Calendar

Google needs one OAuth client per connector, because Google revokes a grant per client. Use two
clients in the same Google Cloud project:

1. Create or choose a project at <https://console.cloud.google.com/>.
2. Enable the APIs:
   - Google Drive: `drive.googleapis.com`
   - Gmail: `gmail.googleapis.com`
   - Calendar: `calendar-json.googleapis.com`
3. Configure the OAuth consent screen:
   - Google Drive scope: `https://www.googleapis.com/auth/drive.readonly`
   - Gmail scopes: `https://www.googleapis.com/auth/gmail.readonly` and
     `https://www.googleapis.com/auth/gmail.send`
   - Calendar scope: `https://www.googleapis.com/auth/calendar.readonly`
   - While the app is in **Testing**, add every Google account that will connect as a test user.
     Testing refresh tokens expire after seven days. A Workspace **Internal** app avoids external
     verification; an External app using Gmail scopes must go through Google verification.
4. Create **Credentials → OAuth client ID → Web application**.
   - Authorised redirect URI: `http://localhost:3101/api/plugins/oauth/callback`
   - Create one client for Drive and one for Gmail/Calendar.
5. In OpenDuet:
   - `/admin/plugins/google-drive`: enable it, paste the Drive client ID and secret, press
     **Refresh tools**.
   - `/admin/plugins/google-workspace`: enable it, paste the Gmail/Calendar client ID and secret,
     press **Refresh tools**.
6. Connect as a person:
   - `/connections/google-drive` → **Connect**
   - `/connections/google-workspace` → **Connect**

The secret is encrypted with `KEY_ENCRYPTION_KEY` and is never read back to the browser.

If you do not have a Google Cloud project, the local fake Google server can exercise the connector
without a real mailbox. See [google-workspace.md](google-workspace.md#trying-it-without-a-google-account).

## Notion

Notion uses RFC 7591 dynamic client registration, so there is no client ID or secret to create.

1. Open `/admin/plugins/notion`.
2. Press **Connect** under **Your account** and complete Notion's consent screen.
3. Return to the plugin page and press **Refresh tools**.
4. Grant the tools to OpenDuet (or tell the administrator to do it).

Until step 2, the plugin legitimately has no tools: Notion's tool listing requires a person's
credential.

## Hundreds of other apps: Composio or Arcade

This is the safe "login with Google and all the rest" path. The broker holds the OAuth consent and
this deployment never sees a password.

### Composio

1. Create a Composio account and obtain an API key.
2. Add it to `openbot/.env` (not in chat, not in a commit):

   ```sh
   COMPOSIO_API_KEY=your-key
   ```

3. Restart the local stack:

   ```sh
   cd openbot
   bun run local:down
   bun run local:up
   ```

4. Open `/admin/plugins` → **More apps** (Composio).
5. Enable the app you need, grant its actions to OpenDuet, then open `/connections` and press
   **Connect** to consent with that app's own account.

One key is shared by the deployment; Composio separates each person's connections by user id. See
[composio.md](composio.md).

### Arcade

The same path is available through Arcade. Set `ARCADE_API_KEY`, and if both broker keys are set,
choose one with `OPENBOT_BROKER_PROVIDER=arcade` (or `composio`). See [arcade.md](arcade.md).

## Sign in with Google (optional app login)

This is separate from plugin OAuth. It controls who may sign in to OpenDuet itself, not which
mailbox a Bot can read.

1. Create another OAuth client of type **Web application**.
2. Add the sign-in callback:

   ```text
   http://localhost:3101/api/auth/callback/google
   ```

3. Set in `openbot/.env`:

   ```sh
   GOOGLE_OAUTH_CLIENT_ID=...
   GOOGLE_OAUTH_CLIENT_SECRET=...
   ```

4. Restart the stack.

A local single-user install currently runs in development-admin mode; adding this makes sign-in
real and should be done before exposing the deployment beyond localhost.

## Adding API-key plugins later

For higher limits, create a key at Parallel, Exa, or Firecrawl and add the matching
`*-authenticated` catalogue entry from `/admin/plugins`. The key is stored in the credential vault,
not in this document or in source control.
