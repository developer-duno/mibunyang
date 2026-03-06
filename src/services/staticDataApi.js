export async function fetchStaticApartments() {
  const res = await fetch("/data/apartments.json");
  if (!res.ok) throw new Error(`Static data fetch failed: ${res.status}`);
  const json = await res.json();
  if (!json.ok || !json.data?.length) throw new Error("Static data empty");
  return json;
}
