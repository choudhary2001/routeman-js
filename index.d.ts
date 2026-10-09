// Type definitions for the routeman programmatic API.

export type AuthType = 'none' | 'bearer' | 'token' | 'basic' | 'apikey' | 'header' | 'session';

export interface Field {
  name: string;
  type: 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object' | 'file' | 'uuid' | 'objectid' | 'date' | 'datetime' | 'time' | 'email' | 'url' | 'any';
  required: boolean;
  description: string;
  choices: unknown[] | null;
  item: Field | null;
  children: Field[] | null;
}

export interface Route {
  method: string;
  path: string;
  name: string;
  description: string;
  folder: string[];
  pathParams: Field[];
  query: Field[];
  headers: Field[];
  body: { mode: 'json' | 'form' | 'urlencoded' | 'raw'; fields: Field[]; partial: boolean } | null;
  auth: null | 'none' | 'refresh';
  isLogin: boolean;
  source: string;
}

export interface Api {
  framework: string;
  routes: Route[];
  websockets: { path: string; description: string; source: string }[];
  auth: AuthType;
  authHeader: string;
  tokenPrefix: string;
  loginPath: string | null;
  port: number | null;
  warnings: string[];
}

export interface GenerateOptions {
  /** Project folder (default: current directory). */
  project?: string;
  /** 'auto' (default) or a framework id such as 'express', 'nest', 'fastify'. */
  framework?: string;
  /** Entry file(s), relative to the project. Detected when omitted. */
  entry?: string | string[];
  /** Collection name (default: from package.json). */
  name?: string;
  /** Output folder for write() (default: 'postman'). */
  output?: string;
  /** Base URL of the "local" environment. */
  baseUrl?: string;
  /** Extra environments: { production: 'https://api.example.com' }. */
  environments?: Record<string, string>;
  /** Regular expressions of paths to leave out. */
  exclude?: string | string[];
  auth?: 'auto' | AuthType;
  /** POST path whose response contains the token. */
  login?: string;
  /** Build from an OpenAPI / Swagger document (file or URL) instead of source code. */
  openapi?: string;
  /** .env file with values the code reads. */
  envFile?: string;
  authHeader?: string;
  tokenPrefix?: string;
}

export interface GenerateResult {
  api: Api;
  /** Postman collection v2.1 */
  collection: Record<string, unknown>;
  environments: { name: string; file: string; data: Record<string, unknown> }[];
  config: Record<string, unknown>;
  root: string;
  warnings: string[];
  ms: number;
  version: string;
}

/** Analyse the project (its code is never run) and build the collection and environments. */
export function generate(options?: GenerateOptions): Promise<GenerateResult>;
/** Write the result of generate() to the output folder; returns the file paths. */
export function write(result: GenerateResult): string[];
/** Lower-level: analyse a project folder into the API model. */
export function analyze(options: { root: string; framework?: string; entries?: string[]; exclude?: string[]; envFile?: string }): Api;
/** Convert an OpenAPI 3 / Swagger 2 document into the API model. */
export function fromOpenapi(spec: object, framework?: string): Api;
export const VERSION: string;
export class ProjectError extends Error {}
export class ConfigError extends Error {}
