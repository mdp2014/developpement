
export function rejectResponse(reason = "Forbidden", status = 403): Response {
  return new Response(JSON.stringify(reason ), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

// shared/http.ts
export function jsonResponse(data: unknown, {
  status = 200,
  headers = {},
}: {
  status?: number;
  headers?: HeadersInit;
} = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}
