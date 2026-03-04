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
  ],
  components: {
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
  },
};

const swaggerOptions = {
  definition: swaggerDefinition,
  apis: [],
};
export const swaggerSpec = swaggerJsdoc(swaggerOptions);
