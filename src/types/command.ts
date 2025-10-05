import { Message, Client, Interaction } from 'discord.js';

export interface Command {
    name: string;
    description: string;
    aliases?: string[];
    usage?: string;
    admin?: boolean; 
    execute: (client: Client, message: Message, args: string[]) => Promise<void> | void;
    handleInteraction?: (interaction: Interaction) => Promise<void>;
}