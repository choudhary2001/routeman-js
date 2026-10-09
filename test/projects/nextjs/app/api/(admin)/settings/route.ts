import { NextRequest, NextResponse } from "next/server";
import { settings } from "@/lib/db";
import { getSessionUser, unauthorized, forbidden } from "@/lib/auth";

async function requireAdmin(request: NextRequest) {
  const session = await getSessionUser(request);
  if (!session) return unauthorized();
  if (session.role !== "admin") return forbidden();
  return null;
}

export async function GET(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  return NextResponse.json(settings);
}

export async function PUT(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const { maintenanceMode, signupsEnabled, supportEmail } = await request.json();
  Object.assign(settings, {
    maintenanceMode: Boolean(maintenanceMode),
    signupsEnabled: Boolean(signupsEnabled),
    supportEmail: String(supportEmail ?? settings.supportEmail),
  });
  return NextResponse.json(settings);
}
