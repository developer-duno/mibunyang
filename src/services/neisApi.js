export async function fetchEducationData(apartments) {
  const res = await fetch("/api/neis/schools", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apartments: apartments.map(a => ({
        id: a.id, lat: a.lat, lng: a.lng, region: a.region, gu: a.gu,
      })),
    }),
  });
  if (!res.ok) throw new Error(`Education API error: ${res.status}`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "Unknown Education error");
  return json;
}
