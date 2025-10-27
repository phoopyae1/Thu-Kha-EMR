declare module 'swagger-ui-express' {
  import type { RequestHandler } from 'express';

  export interface SwaggerUiOptions {
    explorer?: boolean;
    swaggerOptions?: Record<string, unknown>;
    customCss?: string;
    customCssUrl?: string | string[];
    customfavIcon?: string;
    customSiteTitle?: string;
  }

  export const serve: RequestHandler[];

  export function setup(
    document?: unknown,
    customOptions?: SwaggerUiOptions,
    options?: SwaggerUiOptions,
    customCss?: string,
    customfavIcon?: string,
    swaggerUrl?: string,
  ): RequestHandler;

  const swaggerUi: {
    serve: typeof serve;
    setup: typeof setup;
  };

  export default swaggerUi;
}
