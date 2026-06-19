import { SchemaType } from '@google/generative-ai';
import type { ToolSchema, ToolSchemaProperty } from './tool-types';

type SchemaTypeMapper = (type: ToolSchemaProperty['type']) => string | SchemaType;

const convertProperty = (
  property: ToolSchemaProperty,
  mapType: SchemaTypeMapper,
): Record<string, any> => {
  const result: Record<string, any> = { type: mapType(property.type) };
  if (property.description) result.description = property.description;
  if (property.enum) result.enum = property.enum;
  if (property.type === 'object') {
    result.properties = Object.fromEntries(
      Object.entries(property.properties ?? {}).map(([key, value]) => [key, convertProperty(value, mapType)]),
    );
    if (property.required?.length) result.required = property.required;
  }
  if (property.type === 'array' && property.items) {
    result.items = convertProperty(property.items, mapType);
  }
  return result;
};

const mapGeminiType = (type: ToolSchemaProperty['type']): SchemaType => {
  switch (type) {
    case 'string': return SchemaType.STRING;
    case 'number': return SchemaType.NUMBER;
    case 'boolean': return SchemaType.BOOLEAN;
    case 'array': return SchemaType.ARRAY;
    default: return SchemaType.OBJECT;
  }
};

export const toOpenAISchema = (schema: ToolSchema): Record<string, any> => convertProperty(schema, (type) => type);

export const toGeminiSchema = (schema: ToolSchema): Record<string, any> => convertProperty(schema, mapGeminiType);
