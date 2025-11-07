/// <reference types="https://deno.land/x/types/server.d.ts" />

declare module "https://deno.land/std@0.168.0/http/server.ts" {
  export function serve(handler: (request: Request) => Response | Promise<Response>): void;
}