const REGION_RE = /^[\uac00-\ud7a3\sA-Za-z0-9_-]{1,40}$/;
const APARTMENT_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

export function validateApartmentPayload(body, options = {}) {
  const { max = 50, requireCoordinates = false } = options;
  const apartments = body?.apartments;

  if (!Array.isArray(apartments)) {
    return { ok: false, status: 400, error: "apartments array required" };
  }
  if (apartments.length > max) {
    return { ok: false, status: 400, error: `apartments must contain at most ${max} items` };
  }

  const normalized = [];
  for (const apt of apartments) {
    const validated = validateApartment(apt, { requireCoordinates });
    if (!validated.ok) return validated;
    normalized.push(validated.apartment);
  }

  return { ok: true, apartments: normalized };
}

export function validateApartmentListQuery(query = {}) {
  const region = normalizeOptionalText(query.region, "region");
  if (!region.ok) return region;
  const gu = normalizeOptionalText(query.gu, "gu");
  if (!gu.ok) return gu;

  const limit = parseBoundedInteger(query.limit, "limit", { min: 1, max: 10000, defaultValue: 10000 });
  if (!limit.ok) return limit;
  const offset = parseBoundedInteger(query.offset, "offset", { min: 0, max: 1000000, defaultValue: 0 });
  if (!offset.ok) return offset;

  return {
    ok: true,
    query: {
      region: region.value,
      gu: gu.value,
      limit: limit.value,
      offset: offset.value,
      hasExplicitPagination: query.limit != null || query.offset != null,
    },
  };
}

function validateApartment(apt, { requireCoordinates }) {
  if (!apt || typeof apt !== "object" || Array.isArray(apt)) {
    return invalid("apartment must be an object");
  }

  const id = normalizeId(apt.id);
  if (!id) return invalid("apartment id is required");

  const lat = normalizeCoordinate(apt.lat, "lat");
  if (!lat.ok) return lat;
  const lng = normalizeCoordinate(apt.lng, "lng");
  if (!lng.ok) return lng;
  if (requireCoordinates && (lat.value == null || lng.value == null)) {
    return invalid("apartment lat/lng are required");
  }
  if ((lat.value == null) !== (lng.value == null)) {
    return invalid("apartment lat/lng must be provided together");
  }

  const region = normalizeOptionalText(apt.region, "region");
  if (!region.ok) return region;
  const gu = normalizeOptionalText(apt.gu, "gu");
  if (!gu.ok) return gu;

  return {
    ok: true,
    apartment: { ...apt, id, lat: lat.value, lng: lng.value, region: region.value, gu: gu.value },
  };
}

function normalizeId(value) {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return APARTMENT_ID_RE.test(trimmed) ? trimmed : null;
}

function normalizeCoordinate(value, name) {
  if (value == null || value === "") return { ok: true, value: null };
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return invalid(`apartment ${name} must be a number`);
  if (name === "lat" && (number < -90 || number > 90)) return invalid("apartment lat is out of range");
  if (name === "lng" && (number < -180 || number > 180)) return invalid("apartment lng is out of range");
  return { ok: true, value: number };
}

function normalizeOptionalText(value, name) {
  if (value == null || value === "") return { ok: true, value: undefined };
  if (Array.isArray(value) || typeof value !== "string") return invalid(`${name} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: undefined };
  if (!REGION_RE.test(trimmed)) return invalid(`${name} is invalid`);
  return { ok: true, value: trimmed };
}

function parseBoundedInteger(value, name, { min, max, defaultValue }) {
  if (value == null || value === "") return { ok: true, value: defaultValue };
  if (Array.isArray(value)) return invalid(`${name} must be a single value`);
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return invalid(`${name} must be an integer`);
  if (parsed < min || parsed > max) return invalid(`${name} is out of range`);
  return { ok: true, value: parsed };
}

function invalid(error) {
  return { ok: false, status: 400, error };
}
