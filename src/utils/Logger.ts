// Provide a safe Logger wrapper. Some parts of the app may replace `console`
// (or set `global.Logger`) during startup which can accidentally create
// circular/wrapped logging that results in duplicate lines. To make the
// logger robust we capture the *original* console methods once and always
// write through them. We also expose a singleton `Logger` on `global` so
// all modules share the same instance.

// Keep a reference to the original console methods (store on global so
// multiple module instances still reuse the same originals).
const ORIGINAL_CONSOLE_KEY = '__original_console_v1';
const originalConsole: Record<string, Function> = (global as any)[ORIGINAL_CONSOLE_KEY] || {
	log: console.log.bind(console),
	info: console.info ? console.info.bind(console) : console.log.bind(console),
	warn: console.warn ? console.warn.bind(console) : console.log.bind(console),
	error: console.error ? console.error.bind(console) : console.log.bind(console),
	debug: console.debug ? console.debug.bind(console) : console.log.bind(console),
};
(global as any)[ORIGINAL_CONSOLE_KEY] = originalConsole;

const fallback = {
	debug: (...args: any[]) => (originalConsole.debug as Function)(...args),
	info: (...args: any[]) => (originalConsole.info as Function)(...args),
	warn: (...args: any[]) => (originalConsole.warn as Function)(...args),
	error: (...args: any[]) => (originalConsole.error as Function)(...args),
	// `success` is used across the codebase for positive status messages
	success: (...args: any[]) => (originalConsole.log as Function)(...args)
};

// Convenience helper for logging command executions. Kept minimal so tests
// or alternate runtimes can override `global.__app_logger_v1` if needed.
;(fallback as any).command = (commandName: string, userId: string, guildId?: string) => {
    const guildInfo = guildId ? `guild=${guildId}` : 'guild=DM';
    (originalConsole.log as Function)(`[command] name=${commandName} user=${userId} ${guildInfo}`);
};

// Respect an existing global Logger if one was deliberately set by another
// entrypoint (e.g. tests or web debug helpers). Otherwise expose our
// fallback and keep it on global so repeated module loads still get the
// same object.
const GLOBAL_LOGGER_KEY = '__app_logger_v1';
if (!(global as any)[GLOBAL_LOGGER_KEY]) {
	(global as any)[GLOBAL_LOGGER_KEY] = fallback;
}

export const Logger = (global as any)[GLOBAL_LOGGER_KEY];
