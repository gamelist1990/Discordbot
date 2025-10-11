
/**
 * Represents a single message in an OpenAI chat completion.
 */
export interface OpenAIChatCompletionMessage {
    role: 'system' | 'user' | 'assistant' | 'function' | 'tool';
    content: string | OpenAIContentPart[] | null;
    name?: string; // Required for function messages, optional for others
    function_call?: {
        name: string;
        arguments: string;
    };
    tool_calls?: OpenAIToolCall[];
    tool_call_id?: string; // For tool response messages
}

/**
 * Content part for vision-enabled messages
 */
export interface OpenAIContentPart {
    type: 'text' | 'image_url';
    text?: string;
    image_url?: {
        url: string;
        detail?: 'low' | 'high' | 'auto';
    };
}

/**
 * Represents the request payload for an OpenAI chat completion.
 */
export interface OpenAIChatCompletionRequest {
    model: string;
    messages: OpenAIChatCompletionMessage[];
    temperature?: number;
    top_p?: number;
    n?: number; // How many chat completion choices to generate for each input message.
    stream?: boolean;
    stop?: string | string[];
    max_tokens?: number;
    presence_penalty?: number;
    frequency_penalty?: number;
    logit_bias?: { [key: string]: number };
    user?: string; // A unique identifier for the end-user
    function_call?: 'none' | 'auto' | { name: string };
    functions?: {
        name: string;
        description?: string;
        parameters: object; // JSON Schema object
    }[];
    tools?: OpenAITool[];
    tool_choice?: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } };
    response_format?: {
        type: 'json_object' | 'text';
    };
    seed?: number;
}

/**
 * Represents the full response from a non-streaming OpenAI chat completion.
 */
export interface OpenAIChatCompletionResponse {
    id: string;
    object: 'chat.completion';
    created: number; // Unix timestamp
    model: string;
    choices: {
        index: number;
        message: OpenAIChatCompletionMessage;
        logprobs?: any; // For log probability information, if requested
        finish_reason: 'stop' | 'length' | 'function_call' | 'tool_calls' | 'content_filter';
    }[];
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
    system_fingerprint?: string; // New in gpt-4-turbo, for reproducibility
}

/**
 * Represents a single chunk received during a streaming OpenAI chat completion.
 */
export interface OpenAIChatCompletionChunk {
    id: string;
    object: 'chat.completion.chunk';
    created: number; // Unix timestamp
    model: string;
    choices: {
        index: number;
        delta: {
            content?: string;
            role?: 'system' | 'user' | 'assistant' | 'function' | 'tool';
            function_call?: {
                name?: string;
                arguments?: string;
            };
            tool_calls?: {
                index: number;
                id?: string;
                type?: 'function';
                function?: {
                    name?: string;
                    arguments?: string;
                };
            }[];
        };
        finish_reason: 'stop' | 'length' | 'function_call' | 'tool_calls' | 'content_filter' | null;
        logprobs?: any; // For log probability information, if requested
    }[];
    system_fingerprint?: string;
}

/**
 * Represents a tool (function) definition for OpenAI API
 */
export interface OpenAITool {
    type: 'function';
    function: {
        name: string;
        description?: string;
        parameters: object; // JSON Schema object
    };
}

/**
 * Represents a tool call in OpenAI responses
 */
export interface OpenAIToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string; // JSON string
    };
}

/**
 * Handler function for tool execution
 */
export type ToolHandler = (args: any, context?: any) => Promise<string | object> | string | object;