export async function fetchBuilderFinancials(builders) {
  const res = await fetch("/api/dart/builders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ builders }),
  });
  if (!res.ok) throw new Error(`DART API error: ${res.status}`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error);
  return json;
}
