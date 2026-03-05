export async function fetchKosisStats() {
  const res = await fetch("/api/kosis/stats");
  if (!res.ok) throw new Error(`KOSIS API error: ${res.status}`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "Unknown KOSIS error");
  return json;
}
