import assert from 'node:assert/strict';
import { SchemaType } from '@google/generative-ai';
import { toGeminiSchema, toOpenAISchema } from '../../src/bll/agent/tool-schema';
import type { ToolSchema } from '../../src/bll/agent/tool-types';

const schema: ToolSchema = {
  type: 'object',
  required: ['name', 'items'],
  properties: {
    name: {
      type: 'string',
      description: 'Display name',
      enum: ['alpha', 'beta'],
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['amount'],
        properties: {
          amount: { type: 'number' },
          active: { type: 'boolean' },
        },
      },
    },
  },
};

assert.deepEqual(toOpenAISchema(schema), {
  type: 'object',
  required: ['name', 'items'],
  properties: {
    name: {
      type: 'string',
      description: 'Display name',
      enum: ['alpha', 'beta'],
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['amount'],
        properties: {
          amount: { type: 'number' },
          active: { type: 'boolean' },
        },
      },
    },
  },
});

assert.deepEqual(toGeminiSchema(schema), {
  type: SchemaType.OBJECT,
  required: ['name', 'items'],
  properties: {
    name: {
      type: SchemaType.STRING,
      description: 'Display name',
      enum: ['alpha', 'beta'],
    },
    items: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        required: ['amount'],
        properties: {
          amount: { type: SchemaType.NUMBER },
          active: { type: SchemaType.BOOLEAN },
        },
      },
    },
  },
});

console.log('tool-schema.check.ts: all checks passed');
