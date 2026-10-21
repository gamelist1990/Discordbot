/** Only label explicit input/context-limit errors; unrelated failures keep their own handling. */
export function isStaffAIContextLimitError(message: string): boolean {
    return /context_length_exceeded|maximum context length|context (?:window|size|length).*(?:exceed|limit)|(?:exceed|too (?:long|large)).{0,80}(?:context|input|token)|(?:input|prompt).*(?:too (?:long|large)|token limit|exceeds)/i.test(message);
}
