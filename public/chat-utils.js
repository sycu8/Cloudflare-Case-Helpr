export function parseHumanUtc(input, referenceDate = new Date()) {
  const value = input.trim();
  if (!value) return "";

  const relative = parseRelativeDate(value, referenceDate);
  if (relative) return relative.toISOString();

  const numericDate = value.match(
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+|T)(\d{1,2})(?::(\d{2}))?(?:\s*(am|pm))?(?:\s*(?:UTC|GMT))?$/i,
  );
  if (numericDate) {
    const [, day, month, year, rawHour, minute = "0", meridiem] =
      numericDate;
    const hour = normalizeHour(Number(rawHour), meridiem);
    const result = new Date(
      Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        hour,
        Number(minute),
      ),
    );
    return isValidDate(result) ? result.toISOString() : "";
  }

  const timezone = parseTimezoneOffset(value);
  let normalized = value
    .replace(/\s+at\s+/gi, " ")
    .replace(
      /\b(?:UTC|GMT)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?\b/gi,
      (_, sign, hours, minutes = "0") =>
        `GMT${sign}${String(hours).padStart(2, "0")}${String(minutes).padStart(2, "0")}`,
    )
    .replace(/\bUTC\b/gi, "GMT");

  if (!timezone.hasTimezone) normalized += " GMT";
  const timestamp = Date.parse(normalized);
  if (Number.isNaN(timestamp)) return "";
  return new Date(timestamp).toISOString();
}

function parseRelativeDate(value, referenceDate) {
  const match = value.match(
    /\b(today|yesterday|tomorrow|now)\b(?:\s+at)?(?:\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?(?:\s*(?:UTC|GMT)\s*([+-]\s*\d{1,2}(?::?\d{2})?)?)?/i,
  );
  if (!match) return null;

  const [, relativeWord, rawHour, rawMinute = "0", meridiem, rawOffset] =
    match;
  const base = new Date(
    Date.UTC(
      referenceDate.getUTCFullYear(),
      referenceDate.getUTCMonth(),
      referenceDate.getUTCDate(),
    ),
  );
  if (relativeWord.toLowerCase() === "yesterday") {
    base.setUTCDate(base.getUTCDate() - 1);
  } else if (relativeWord.toLowerCase() === "tomorrow") {
    base.setUTCDate(base.getUTCDate() + 1);
  }
  if (relativeWord.toLowerCase() === "now" && !rawHour) {
    return new Date(referenceDate);
  }

  const hour = normalizeHour(Number(rawHour ?? 0), meridiem);
  const minute = Number(rawMinute);
  if (hour > 23 || minute > 59) return null;
  const offsetMinutes = rawOffset ? offsetToMinutes(rawOffset) : 0;
  base.setUTCHours(hour, minute, 0, 0);
  base.setTime(base.getTime() - offsetMinutes * 60_000);
  return base;
}

function parseTimezoneOffset(value) {
  const match = value.match(
    /\b(?:UTC|GMT)\s*([+-])?\s*(\d{1,2})?(?::?(\d{2}))?\b/i,
  );
  return {
    hasTimezone: Boolean(match),
    offsetMinutes:
      match?.[1] && match[2]
        ? offsetToMinutes(`${match[1]}${match[2]}${match[3] ?? ""}`)
        : 0,
  };
}

function offsetToMinutes(value) {
  const match = value.replace(/\s/g, "").match(/^([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) return 0;
  const sign = match[1] === "+" ? 1 : -1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0));
}

function normalizeHour(hour, meridiem) {
  if (!meridiem) return hour;
  if (hour < 1 || hour > 12) return 99;
  const normalized = hour % 12;
  return meridiem.toLowerCase() === "pm" ? normalized + 12 : normalized;
}

function isValidDate(value) {
  return !Number.isNaN(value.getTime());
}
