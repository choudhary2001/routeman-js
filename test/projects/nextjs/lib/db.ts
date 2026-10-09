export type Role = "admin" | "user";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  bio?: string;
  passwordHash: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  actor: string;
  action: string;
  at: string;
}

export const users = new Map<string, User>([
  [
    "1",
    {
      id: "1",
      name: "admin",
      email: "admin@example.com",
      role: "admin",
      passwordHash: "Str0ngPassw0rd!",
      createdAt: new Date(0).toISOString(),
    },
  ],
]);

export const auditLogs: AuditLog[] = [
  { id: "1", actor: "admin@example.com", action: "login", at: new Date(0).toISOString() },
];

export const settings = {
  maintenanceMode: false,
  signupsEnabled: true,
  supportEmail: "support@example.com",
};

export function publicUser({ passwordHash: _ignored, ...rest }: User) {
  return rest;
}
