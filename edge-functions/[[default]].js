export default async function onRequest(context) {
  const request = context.request;
  const method = (request.method || "GET").toUpperCase();
  const corsHeaders = new Headers();

  corsHeaders.set("Access-Control-Allow-Origin", "*");
  corsHeaders.set(
    "Access-Control-Allow-Methods",
    "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS"
  );
  corsHeaders.set("Access-Control-Allow-Headers", "*");
  corsHeaders.set("Access-Control-Max-Age", "86400");

  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const baseResponse = await fetch(request);
    const responseHeaders = new Headers(baseResponse.headers);
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");
    responseHeaders.delete("transfer-encoding");
    corsHeaders.forEach((value, key) => responseHeaders.set(key, value));

    return new Response(baseResponse.body, {
      status: baseResponse.status,
      statusText: baseResponse.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    const headers = new Headers(corsHeaders);
    headers.set("Content-Type", "application/json; charset=utf-8");
    return new Response(
      JSON.stringify({
        error: "Edge function proxy failed",
        message: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 502,
        headers,
      }
    );
  }
}
