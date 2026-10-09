import { login } from "./routes/auth";
import { createItem, deleteItem, getItem, listItems, updateItem } from "./routes/items";

const startedAt = Date.now();

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),

  routes: {
    "/api/health": new Response("ok"),
    "/api/status": () => Response.json({ status: "ok", uptimeMs: Date.now() - startedAt }),

    "/api/auth/login": {
      POST: login,
    },

    "/api/items": {
      GET: listItems,
      POST: createItem,
    },

    "/api/items/:id": {
      GET: getItem,
      PUT: updateItem,
      DELETE: deleteItem,
    },
  },

  fetch(req) {
    return Response.json({ error: `Cannot ${req.method} ${new URL(req.url).pathname}` }, { status: 404 });
  },

  error(err) {
    console.error(err);
    return Response.json({ error: "Internal Server Error" }, { status: 500 });
  },
});

console.log(`Listening on ${server.url}`);
