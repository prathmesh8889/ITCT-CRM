const crypto = require("crypto");

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar";

const cfg = {
  calendarId: String(process.env.GOOGLE_CALENDAR_ID || "").trim(),
  serviceAccountEmail: String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "").trim(),
  privateKey: String(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim(),
  timeZone: String(process.env.GOOGLE_CALENDAR_TIMEZONE || "Asia/Kolkata").trim(),
  utcOffset: String(process.env.GOOGLE_CALENDAR_UTC_OFFSET || "+05:30").trim(),
};

let tokenCache = { value: "", expiresAt: 0 };

function isConfigured() {
  return Boolean(cfg.calendarId && cfg.serviceAccountEmail && cfg.privateKey);
}

function base64url(value) {
  return Buffer.from(value).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function accessToken() {
  if (!isConfigured()) return null;
  if (tokenCache.value && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: cfg.serviceAccountEmail,
    scope: GOOGLE_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(cfg.privateKey, "base64")
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const assertion = `${unsigned}.${signature}`;

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "Google Calendar authentication failed");
  }
  tokenCache = {
    value: data.access_token,
    expiresAt: Date.now() + Math.max(300, Number(data.expires_in || 3600) - 60) * 1000,
  };
  return tokenCache.value;
}

async function googleRequest(path, { method = "GET", body } = {}) {
  const token = await accessToken();
  if (!token) throw new Error("Google Calendar is not configured");
  const response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || data?.error_description || "Google Calendar request failed";
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }
  return data;
}

function localStamp(date, time) {
  return `${date}T${time}:00${cfg.utcOffset}`;
}

function intervalMs(date, time) {
  return new Date(localStamp(date, time)).getTime();
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

async function getBusyIntervals(date, start = "00:00", end = "23:59") {
  if (!isConfigured()) return [];
  const data = await googleRequest("/freeBusy", {
    method: "POST",
    body: {
      timeMin: localStamp(date, start),
      timeMax: localStamp(date, end),
      timeZone: cfg.timeZone,
      items: [{ id: cfg.calendarId }],
    },
  });
  return data?.calendars?.[cfg.calendarId]?.busy || [];
}

async function isSlotBusy(date, start, end) {
  if (!isConfigured()) return false;
  const targetStart = intervalMs(date, start);
  const targetEnd = intervalMs(date, end);
  const busy = await getBusyIntervals(date, start, end);
  return busy.some((item) => overlaps(
    new Date(item.start).getTime(),
    new Date(item.end).getTime(),
    targetStart,
    targetEnd,
  ));
}

async function createEvent({ meetingId, title, date, start, end, location, agenda, createMeet = true }) {
  if (!isConfigured()) return null;
  const base = {
    summary: title,
    description: [
      agenda || "",
      "",
      `Created from ITCT CRM · Meeting #${meetingId}`,
    ].join("\n").trim(),
    location: location || "",
    start: { dateTime: localStamp(date, start), timeZone: cfg.timeZone },
    end: { dateTime: localStamp(date, end), timeZone: cfg.timeZone },
    extendedProperties: { private: { itctMeetingId: String(meetingId) } },
  };

  const create = async (withMeet) => googleRequest(
    `/calendars/${encodeURIComponent(cfg.calendarId)}/events?conferenceDataVersion=${withMeet ? 1 : 0}`,
    {
      method: "POST",
      body: withMeet ? {
        ...base,
        conferenceData: {
          createRequest: {
            requestId: `itct-${meetingId}-${Date.now()}`,
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      } : base,
    },
  );

  let event;
  try {
    event = await create(Boolean(createMeet));
  } catch (error) {
    if (!createMeet) throw error;
    event = await create(false);
  }

  const meetLink = event?.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri || "";
  return {
    id: event?.id || "",
    htmlLink: event?.htmlLink || "",
    meetLink,
  };
}

module.exports = {
  googleCalendarConfigured: isConfigured,
  getGoogleBusyIntervals: getBusyIntervals,
  isGoogleSlotBusy: isSlotBusy,
  createGoogleCalendarEvent: createEvent,
  googleCalendarTimeZone: cfg.timeZone,
  googleLocalEpoch: intervalMs,
};
