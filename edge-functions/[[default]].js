export default async function onRequest(context) {
  const request = context.request;
  const method = request.method || "GET";
  const headers = new Headers();

  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "*");

  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  const baseResponse = await fetch(request);
  const responseHeaders = new Headers(baseResponse.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  responseHeaders.delete("transfer-encoding");
  headers.forEach((value, key) => responseHeaders.set(key, value));

  return new Response(baseResponse.body, {
    status: baseResponse.status,
    statusText: baseResponse.statusText,
    headers: responseHeaders,
  });
}
