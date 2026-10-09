import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { users, publicUser, type User } from "@/lib/db";
import { getSessionUser, unauthorized } from "@/lib/auth";

const createUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["admin", "user"]).default("user"),
});

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const page = Number(searchParams.get("page") ?? "1");
  const limit = Number(searchParams.get("limit") ?? "20");
  const search = searchParams.get("search")?.toLowerCase();

  let list = [...users.values()];
  if (search) {
    list = list.filter((u) => u.name.toLowerCase().includes(search) || u.email.includes(search));
  }

  const start = (page - 1) * limit;
  return NextResponse.json({
    data: list.slice(start, start + limit).map(publicUser),
    page,
    total: list.length,
  });
}

export async function POST(request: NextRequest) {
  const session = await getSessionUser(request);
  if (!session) return unauthorized();

  const parsed = createUserSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ errors: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  const { password, ...data } = parsed.data;
  if ([...users.values()].some((u) => u.email === data.email)) {
    return NextResponse.json({ error: "Email already in use" }, { status: 409 });
  }

  const user: User = {
    ...data,
    id: crypto.randomUUID(),
    passwordHash: password,
    createdAt: new Date().toISOString(),
  };
  users.set(user.id, user);

  return NextResponse.json(publicUser(user), { status: 201 });
}
