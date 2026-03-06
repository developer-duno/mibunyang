export async function fetchApplyHomeApartments() {
  const res = await fetch("/api/applyhome/apartments");
  if (!res.ok) throw new Error(`ApplyHome API error: ${res.status}`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "Unknown ApplyHome error");
  return json;
}
