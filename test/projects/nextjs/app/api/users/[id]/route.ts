import { NextRequest, NextResponse } from "next/server";
import { users, publicUser } from "@/lib/db";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth";

type RouteContext = { params: Promise<{ id: string }> };

function notFound() {
  return NextResponse.json({ error: "User not found" }, { status: 404 });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = users.get(id);
  if (!user) return notFound();
  return NextResponse.json(publicUser(user));
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  const session = await getSessionUser(request);
  if (!session) return unauthorized();

  const { id } = await params;
  const existing = users.get(id);
  if (!existing) return notFound();

  const body = await request.json();
  const { name, email, role } = body;
  if (!name || !email) {
    return NextResponse.json({ error: "name and email are required" }, { status: 400 });
  }

  const updated = { ...existing, name, email, role: role ?? existing.role };
  users.set(id, updated);
  return NextResponse.json(publicUser(updated));
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const session = await getSessionUser(request);
  if (!session) return unauthorized();

  const { id } = await context.params;
  const existing = users.get(id);
  if (!existing) return notFound();

  const body = await request.json();
  const updated = {
    ...existing,
    name: body.name ?? existing.name,
    bio: body.bio ?? existing.bio,
  };
  users.set(id, updated);
  return NextResponse.json(publicUser(updated));
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const session = await getSessionUser(request);
  if (!session) return unauthorized();
  if (session.role !== "admin") return forbidden();

  const { id } = await params;
  if (!users.delete(id)) return notFound();
  return new NextResponse(null, { status: 204 });
}
