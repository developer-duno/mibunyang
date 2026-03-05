export async function fetchKakaoInfra(apartments) {
  const res = await fetch("/api/kakao/infra", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apartments: apartments.map(a => ({ id: a.id, lat: a.lat, lng: a.lng })),
    }),
  });
  if (!res.ok) throw new Error(`Kakao API error: ${res.status}`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "Unknown Kakao error");
  return json;
}
