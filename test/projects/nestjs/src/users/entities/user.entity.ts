export enum Role {
  Admin = 'admin',
  User = 'user',
}

export interface Address {
  street: string;
  city: string;
  postalCode: string;
  country: string;
}

export interface User {
  id: number;
  email: string;
  username: string;
  passwordHash: string;
  role: Role;
  fullName?: string;
  address?: Address;
  avatar?: {
    originalName: string;
    mimeType: string;
    size: number;
    uploadedAt: string;
  };
  createdAt: string;
  updatedAt: string;
}

export type PublicUser = Omit<User, 'passwordHash'>;
