import { NextRequest, NextResponse } from "next/server";
import { auditLogs } from "@/lib/db";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getSessionUser(request);
  if (!session) return unauthorized();
  if (session.role !== "admin") return forbidden();

  const { searchParams } = request.nextUrl;
  const actor = searchParams.get("actor");
  const from = searchParams.get("from");

  const logs = auditLogs.filter(
    (log) => (!actor || log.actor === actor) && (!from || log.at >= from),
  );
  return NextResponse.json({ data: logs });
}
