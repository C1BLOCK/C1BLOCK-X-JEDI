export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export async function readJson(req) {
  try {
    return await req.json();
  } catch {
    throw new Error('JSON non valido');
  }
}
