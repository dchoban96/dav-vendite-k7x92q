// Omaggi DAV - archivio condiviso delle conferme (Cloudflare Worker + KV)
//
// Chiavi KV:
//   conf:<codice cliente>  -> metadata {ok, items, altro, at, by}   (la lista restituisce tutto in una chiamata)
//   costi                  -> {c:{articolo: valore}}
//
// Tutte le richieste richiedono l'header  X-Pin: <PIN>  uguale al segreto PIN del Worker.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-Pin",
  "Access-Control-Max-Age": "86400",
};
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS } });

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");

    if (path === "" || path === "/") return json({ ok: true, servizio: "omaggi-dav" });

    if (!env.PIN) return json({ error: "PIN non configurato nel Worker" }, 500);
    if ((request.headers.get("X-Pin") || "") !== env.PIN) return json({ error: "pin" }, 401);

    // --- conferme ---
    if (path === "/api/conferme" && request.method === "GET") {
      const out = {};
      let cursor;
      do {
        const page = await env.OMAGGI.list({ prefix: "conf:", cursor, limit: 1000 });
        for (const k of page.keys) if (k.metadata) out[k.name.slice(5)] = k.metadata;
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
      return json({ conferme: out, t: Date.now() });
    }

    const m = path.match(/^\/api\/conferme\/([A-Za-z0-9_\-]{1,40})$/);
    if (m && request.method === "PUT") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "json" }, 400); }
      const doc = {
        ok: true,
        items: Array.isArray(body.items) ? body.items.filter(x => typeof x === "string").slice(0, 20).map(x => x.slice(0, 40)) : [],
        altro: typeof body.altro === "string" && body.altro.trim() ? body.altro.trim().slice(0, 80) : null,
        at: new Date().toISOString(),
        by: typeof body.by === "string" && body.by.trim() ? body.by.trim().slice(0, 40) : null,
        over: body.over === true,
      };
      await env.OMAGGI.put("conf:" + m[1], "1", { metadata: doc });
      return json({ ok: true, doc });
    }
    if (m && request.method === "DELETE") {
      await env.OMAGGI.delete("conf:" + m[1]);
      return json({ ok: true });
    }

    // --- costi unitari ---
    if (path === "/api/costi" && request.method === "GET") {
      const v = await env.OMAGGI.get("costi", "json");
      return json({ c: (v && v.c) || {} });
    }
    if (path === "/api/costi" && request.method === "PUT") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "json" }, 400); }
      const c = {};
      for (const [k, v] of Object.entries(body.c || {})) if (/^[a-z_0-9]{1,40}$/.test(k) && typeof v === "number" && v >= 0 && v < 100000) c[k] = v;
      await env.OMAGGI.put("costi", JSON.stringify({ c }));
      return json({ ok: true, c });
    }

    return json({ error: "not found" }, 404);
  },
};
