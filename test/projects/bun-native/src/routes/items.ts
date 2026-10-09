import type { BunRequest } from "bun";
import { items, nextItemId, type Item } from "../lib/db";
import { withAuth } from "../lib/auth";
import { error, json, notFound, readJson } from "../lib/http";

type ItemInput = Partial<Pick<Item, "name" | "description" | "price" | "quantity" | "category">>;

function validate(input: ItemInput, partial: boolean): string[] {
  const problems: string[] = [];
  if (!partial || input.name !== undefined) {
    if (typeof input.name !== "string" || !input.name.trim()) problems.push("name must be a non-empty string");
  }
  if (!partial || input.price !== undefined) {
    if (typeof input.price !== "number" || input.price < 0) problems.push("price must be a non-negative number");
  }
  if (input.quantity !== undefined && (!Number.isInteger(input.quantity) || input.quantity < 0)) {
    problems.push("quantity must be a non-negative integer");
  }
  if (input.description !== undefined && typeof input.description !== "string") {
    problems.push("description must be a string");
  }
  if (input.category !== undefined && typeof input.category !== "string") {
    problems.push("category must be a string");
  }
  return problems;
}

const findItem = (id: string) => items.find((i) => i.id === Number(id));

export function listItems(req: BunRequest<"/api/items">) {
  const params = new URL(req.url).searchParams;
  const q = params.get("q")?.toLowerCase();
  const category = params.get("category");
  const limit = Math.min(Number(params.get("limit") ?? 50) || 50, 100);

  let result = items;
  if (q) result = result.filter((i) => i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q));
  if (category) result = result.filter((i) => i.category === category);

  return json({ items: result.slice(0, limit), total: result.length });
}

export const createItem = withAuth(async (req: BunRequest<"/api/items">) => {
  const body = await readJson<ItemInput>(req);
  if (!body) return error(400, "Request body must be a JSON object");

  const problems = validate(body, false);
  if (problems.length) return error(422, "Validation failed", problems);

  if (items.some((i) => i.name.toLowerCase() === body.name!.toLowerCase())) {
    return error(409, `Item "${body.name}" already exists`);
  }

  const item: Item = {
    id: nextItemId(),
    name: body.name!.trim(),
    description: body.description ?? "",
    price: body.price!,
    quantity: body.quantity ?? 0,
    category: body.category ?? "general",
    createdAt: new Date().toISOString(),
  };
  items.push(item);
  return json(item, { status: 201 });
});

export function getItem(req: BunRequest<"/api/items/:id">) {
  const item = findItem(req.params.id);
  return item ? json(item) : notFound(`Item ${req.params.id} not found`);
}

export const updateItem = withAuth(async (req: BunRequest<"/api/items/:id">) => {
  const item = findItem(req.params.id);
  if (!item) return notFound(`Item ${req.params.id} not found`);

  const body = await readJson<ItemInput>(req);
  if (!body) return error(400, "Request body must be a JSON object");

  const problems = validate(body, true);
  if (problems.length) return error(422, "Validation failed", problems);

  const { name, description, price, quantity, category } = body;
  Object.assign(
    item,
    Object.fromEntries(Object.entries({ name, description, price, quantity, category }).filter(([, v]) => v !== undefined)),
  );
  return json(item);
});

export const deleteItem = withAuth((req: BunRequest<"/api/items/:id">, user) => {
  if (user.role !== "admin") return error(403, "Only admins can delete items");

  const index = items.findIndex((i) => i.id === Number(req.params.id));
  if (index === -1) return notFound(`Item ${req.params.id} not found`);

  items.splice(index, 1);
  return new Response(null, { status: 204 });
});
