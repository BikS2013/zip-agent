import { createAgent } from 'langchain';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { MemorySaver } from '@langchain/langgraph';

export interface CreateAgentGraphArgs {
  model: BaseChatModel;
  tools: StructuredToolInterface[];
  systemPrompt: string;
  checkpointer?: MemorySaver;
}

export type AgentGraph = ReturnType<typeof createAgent>;

/**
 * Thin wrapper around langchain v1 `createAgent`. The library's typed
 * signature treats `responseFormat` as required (see CreateAgentParams
 * intersection); cast through `any` here to keep the call site readable
 * — at runtime, omitting responseFormat is supported.
 */
export function createAgentGraph(args: CreateAgentGraphArgs): AgentGraph {
  const init: Record<string, unknown> = {
    model: args.model,
    tools: args.tools,
    systemPrompt: args.systemPrompt,
  };
  if (args.checkpointer) init['checkpointer'] = args.checkpointer;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createAgent(init as any);
}
