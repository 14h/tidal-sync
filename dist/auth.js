import { readFile, writeFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
const CLIENT_ID = "fX2JxdmntZWK0ixT";
const CLIENT_SECRET = "1Nn9AfDAjxrgJFJbKNWLeAyKGVGmINuXPPLHVXAvxAg=";
const AUTH_BASE = "https://auth.tidal.com/v1/oauth2";
const SCOPE = "r_usr+w_usr+w_sub";
const TOKEN_PATH = join(homedir(), ".tidal-sync.token.json");
function basicAuth() {
    return "Basic " + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
}
export async function getDeviceCode() {
    const res = await fetch(`${AUTH_BASE}/device_authorization`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPE }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Device authorization failed: ${res.status} — ${body}`);
    }
    return res.json();
}
export async function pollForToken(deviceCode, interval, expiresIn) {
    const deadline = Date.now() + expiresIn * 1000;
    while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, interval * 1000));
        const res = await fetch(`${AUTH_BASE}/token`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Authorization: basicAuth(),
            },
            body: new URLSearchParams({
                client_id: CLIENT_ID,
                device_code: deviceCode,
                grant_type: "urn:ietf:params:oauth:grant-type:device_code",
                scope: SCOPE,
            }),
        });
        if (res.ok) {
            const data = await res.json();
            const token = {
                userId: data.user.userId,
                countryCode: data.user.countryCode,
                accessToken: data.access_token,
                refreshToken: data.refresh_token,
                expiresAfter: Date.now() + data.expires_in * 1000,
            };
            await saveToken(token);
            return token;
        }
        const err = await res.json();
        if (err.sub_status !== 1002) {
            throw new Error(`Authentication failed: ${JSON.stringify(err)}`);
        }
        // 1002 = authorization_pending, keep polling
    }
    throw new Error("Login timed out. Please try again.");
}
async function refreshAccessToken(refreshToken) {
    const res = await fetch(`${AUTH_BASE}/token`, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: basicAuth(),
        },
        body: new URLSearchParams({
            client_id: CLIENT_ID,
            refresh_token: refreshToken,
            grant_type: "refresh_token",
            scope: SCOPE,
        }),
    });
    if (!res.ok)
        throw new Error("Token refresh failed");
    const data = await res.json();
    const token = {
        userId: data.user.userId,
        countryCode: data.user.countryCode,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAfter: Date.now() + data.expires_in * 1000,
    };
    await saveToken(token);
    return token;
}
async function saveToken(token) {
    await writeFile(TOKEN_PATH, JSON.stringify(token, null, 2));
}
export async function loadToken() {
    try {
        const raw = await readFile(TOKEN_PATH, "utf-8");
        const token = JSON.parse(raw);
        if (token.expiresAfter > Date.now() + 60_000) {
            return token;
        }
        return await refreshAccessToken(token.refreshToken);
    }
    catch {
        return null;
    }
}
export async function logout() {
    try {
        await unlink(TOKEN_PATH);
    }
    catch {
        // File doesn't exist, that's fine
    }
}
//# sourceMappingURL=auth.js.map