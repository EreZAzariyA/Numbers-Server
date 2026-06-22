import { Content, FunctionDeclaration, GoogleGenerativeAI, Part } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { createOllamaClient } from '../../utils/ollama-client';
import type { ProviderRuntime } from '../agent-manager';
import type { AgentToolDefinition, PendingActionView, SupportedLanguage, ToolExecutionContext } from './tool-types';
import { toGeminiSchema, toOpenAISchema } from './tool-schema';

const MAX_TOOL_ROUNDS = 5;

export type ProviderContext = {
  user_id: string;
  language: SupportedLanguage;
  tools: AgentToolDefinition[];
  stagedActionRef: { value: PendingActionView | null };
  toolUsageRef: NonNullable<ToolExecutionContext['toolUsageRef']>;
  emitProgress?: ToolExecutionContext['emitProgress'];
  executeTool: (name: string, args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<unknown>;
};

function toOpenAIToolsList(tools: AgentToolDefinition[]): OpenAI.Chat.ChatCompletionTool[] {
  return tools.map((definition) => ({
    type: 'function',
    function: {
      name: definition.name,
      description: definition.description,
      parameters: toOpenAISchema(definition.schema),
    },
  }));
}

function toAnthropicToolsList(tools: AgentToolDefinition[]): Anthropic.Tool[] {
  return tools.map((definition) => ({
    name: definition.name,
    description: definition.description,
    input_schema: toOpenAISchema(definition.schema) as Anthropic.Tool['input_schema'],
  }));
}

function toGeminiToolsList(tools: AgentToolDefinition[]): object[] {
  return tools.map((definition) => ({
    name: definition.name,
    description: definition.description,
    parameters: toGeminiSchema(definition.schema),
  }));
}

function buildToolExecContext(ctx: ProviderContext): ToolExecutionContext {
  return {
    user_id: ctx.user_id,
    language: ctx.language,
    stageMutations: true,
    stagedActionRef: ctx.stagedActionRef,
    toolUsageRef: ctx.toolUsageRef,
    emitProgress: ctx.emitProgress,
  };
}

export async function chatWithOllama(
  systemInstruction: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  model: string,
  thinkingEnabled: boolean,
  forceToolUse: boolean,
  ctx: ProviderContext,
): Promise<string> {
  const client = createOllamaClient();

  const effectiveSystemInstruction = thinkingEnabled
    ? systemInstruction
    : `/no_think\n${systemInstruction}`;

  const history: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: effectiveSystemInstruction },
    ...messages.map((message) => ({
      role: (message.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
      content: message.content,
    })),
  ];

  const openAiTools = toOpenAIToolsList(ctx.tools);
  const send = (extra: Partial<OpenAI.Chat.ChatCompletionCreateParamsNonStreaming> = {}) =>
    client.chat.completions.create({
      model,
      messages: history,
      tools: openAiTools,
      ...extra,
    });

  let response = await send(forceToolUse ? { tool_choice: 'required' } : {});
  const toolExecContext = buildToolExecContext(ctx);

  for (let i = 0; i < MAX_TOOL_ROUNDS; i++) {
    const choice = response.choices[0];
    if (choice.finish_reason !== 'tool_calls' || !choice.message.tool_calls?.length) break;

    history.push(choice.message);

    for (const call of choice.message.tool_calls) {
      if (call.type !== 'function') continue;
      const parsedArguments = call.function.arguments
        ? (JSON.parse(call.function.arguments) as Record<string, unknown>)
        : {};
      const result = await ctx.executeTool(call.function.name, parsedArguments, toolExecContext);

      history.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }

    ctx.emitProgress?.('analyzing-results');
    response = await send();
  }

  return response.choices[0].message.content ?? '';
}

export async function chatWithClaude(
  systemInstruction: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  runtime: ProviderRuntime,
  _readOnlyToolsOnly: boolean,
  ctx: ProviderContext,
): Promise<string> {
  const client = new Anthropic({ apiKey: runtime.apiKey! });
  const history: Anthropic.MessageParam[] = messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
  const tools = toAnthropicToolsList(ctx.tools);
  const send = () =>
    client.messages.create({
      model: runtime.model!,
      max_tokens: 1200,
      system: systemInstruction,
      messages: history,
      tools,
    });

  let response = await send();
  const toolExecContext = buildToolExecContext(ctx);

  for (let i = 0; i < MAX_TOOL_ROUNDS; i++) {
    const toolUses = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );
    if (!toolUses.length) break;

    history.push({
      role: 'assistant',
      content: response.content,
    });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      const result = await ctx.executeTool(
        toolUse.name,
        (toolUse.input ?? {}) as Record<string, unknown>,
        toolExecContext,
      );

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify(result),
      });
    }

    history.push({
      role: 'user',
      content: toolResults,
    });

    ctx.emitProgress?.('analyzing-results');
    response = await send();
  }

  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

export async function chatWithGemini(
  systemInstruction: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  runtime: ProviderRuntime,
  _readOnlyToolsOnly: boolean,
  ctx: ProviderContext,
): Promise<string> {
  const genAI = new GoogleGenerativeAI(runtime.apiKey!);
  const model = genAI.getGenerativeModel({
    model: runtime.model!,
    systemInstruction,
    tools: [{ functionDeclarations: toGeminiToolsList(ctx.tools) as FunctionDeclaration[] }],
  });

  const history: Content[] = messages.slice(0, -1).map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }],
  }));

  const chat = model.startChat({ history });
  const lastMessage = messages[messages.length - 1].content;
  let result = await chat.sendMessage(lastMessage);
  const toolExecContext = buildToolExecContext(ctx);

  for (let i = 0; i < MAX_TOOL_ROUNDS; i++) {
    const parts: Part[] = result.response.candidates?.[0]?.content?.parts ?? [];
    const functionCallPart = parts.find((part) => part.functionCall);
    if (!functionCallPart?.functionCall) break;

    const { name, args } = functionCallPart.functionCall;
    const toolResult = await ctx.executeTool(
      name,
      (args ?? {}) as Record<string, unknown>,
      toolExecContext,
    );

    ctx.emitProgress?.('analyzing-results');
    result = await chat.sendMessage([
      {
        functionResponse: {
          name,
          response: { result: JSON.stringify(toolResult) },
        },
      },
    ]);
  }

  return result.response.text();
}
