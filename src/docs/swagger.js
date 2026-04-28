import swaggerJsdoc from "swagger-jsdoc";
import { config } from "../config.js";

const swaggerDefinition = {
  openapi: "3.0.3",
  info: {
    title: "Facebook Video Extractor API",
    version: "1.0.0",
    description:
      "API para leer los enlaces de video directos desde publicaciones de Facebook.",
  },
  servers: [
    {
      url: `http://localhost:${config.port}`,
      description: "Servidor local",
    },
  ],
  tags: [
    {
      name: "Scraper",
      description: "Operaciones relacionadas al scraper de videos",
    },
    {
      name: "Admin",
      description: "Operaciones administrativas seguras",
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
      },
    },
    schemas: {
      ExtractRequest: {
        type: "object",
        required: ["url"],
        properties: {
          url: {
            type: "string",
            format: "uri",
            description: "URL pública de la publicación de Facebook",
            example: "https://www.facebook.com/reel/1234567890",
          },
          options: {
            type: "object",
            properties: {
              timeoutMs: {
                type: "integer",
                minimum: 1000,
                description: "Tiempo máximo en milisegundos para navegar la página",
                example: 20000,
              },
              fetchMetadata: {
                type: "boolean",
                description: "Indica si se debe incluir metadata OG en la respuesta",
                example: true,
              },
              locale: {
                type: "string",
                description: "Lang header opcional (Accept-Language)",
                example: "es-ES",
              },
            },
          },
        },
      },
      ExtractResponse: {
        type: "object",
        properties: {
          requestedUrl: {
            type: "string",
            format: "uri",
          },
          sourceUrl: {
            type: "string",
            format: "uri",
            description: "URL directa al archivo MP4/DASH",
          },
          metadata: {
            type: "object",
            nullable: true,
            properties: {
              title: { type: "string", nullable: true },
              description: { type: "string", nullable: true },
              thumbnail: {
                type: "string",
                nullable: true,
                format: "uri",
              },
              permalink: { type: "string", nullable: true, format: "uri" },
            },
          },
          fetchedAt: {
            type: "string",
            format: "date-time",
          },
        },
      },
      ErrorResponse: {
        type: "object",
        properties: {
          error: { type: "string" },
          code: { type: "string" },
          details: {
            type: "array",
            items: {
              type: "object",
            },
          },
        },
      },
      CookieReplaceResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean", example: true },
          bytes: { type: "integer", example: 1024 },
          cookiesParsed: { type: "integer", example: 12 },
          sha256: {
            type: "string",
            example: "f20f04ed8f9fbc8f9ee6f736f8f7f931d5c7dbaadfcb93f4a4d4e75fc2eeb9d2",
          },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
    },
  },
  paths: {
    "/health": {
      get: {
        tags: ["Scraper"],
        summary: "Ping del servicio",
        responses: {
          200: {
            description: "Estado y uptime del servicio",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string" },
                    busy: {
                      type: "boolean",
                      description: "True cuando hay al menos una extraccion en curso",
                    },
                    uptime: { type: "number" },
                    timestamp: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/extract": {
      post: {
        tags: ["Scraper"],
        summary: "Extrae la URL directa del video",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ExtractRequest" },
            },
          },
        },
        responses: {
          200: {
            description: "Video encontrado",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ExtractResponse" },
              },
            },
          },
          400: {
            description: "Payload inválido",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          404: {
            description: "No se halló ningún video en la publicación",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          502: {
            description: "Facebook bloqueó el request o devolvió un error",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          500: {
            description: "Error inesperado del servidor",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/api/admin/cookies/replace": {
      post: {
        tags: ["Admin"],
        summary: "Replace the Netscape cookie file used by the scraper",
        description:
          "Receives a raw cookies.txt payload and atomically replaces the configured cookie file.",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            in: "header",
            name: "x-cookie-actor",
            schema: { type: "string" },
            required: false,
            description: "Optional actor identifier for audit logs.",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["file"],
                properties: {
                  file: {
                    type: "string",
                    format: "binary",
                    description: "Netscape cookies file (cookies.txt)",
                  },
                },
              },
            },
            "text/plain": {
              schema: { type: "string", format: "binary" },
            },
            "application/octet-stream": {
              schema: { type: "string", format: "binary" },
            },
          },
        },
        responses: {
          200: {
            description: "Cookie file replaced successfully",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CookieReplaceResponse" },
              },
            },
          },
          400: {
            description: "Invalid cookie payload",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          401: {
            description: "Missing Authorization header",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          403: {
            description: "Invalid admin token",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          413: {
            description: "Payload too large",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          500: {
            description: "Unexpected write or server error",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          503: {
            description: "Admin endpoint disabled by configuration",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
  },
};

const swaggerOptions = {
  definition: swaggerDefinition,
  apis: [],
};
export const swaggerSpec = swaggerJsdoc(swaggerOptions);
