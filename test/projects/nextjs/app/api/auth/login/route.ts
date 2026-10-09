import { NextRequest, NextResponse } from "next/server";
import { users } from "@/lib/db";
import { signToken } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const { email, password } = await request.json();

  const user = [...users.values()].find((u) => u.email === email);
  if (!user || user.passwordHash !== password) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = await signToken(user);
  return NextResponse.json({ token, expiresIn: 7200 });
}
