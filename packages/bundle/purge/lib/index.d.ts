import type { Context } from '@deepseek-ai/cordis';

export declare const name = "dsh-purge";
export declare const inject: readonly ["systemPrompt", "tools"];

export interface PurgeConfig {
  enabled?: boolean;
  autoApplyOnStart?: boolean;
  autoUpdateOnStart?: boolean;
  autoRevertOnMissing?: boolean;
  injectOnce?: boolean;
  stripMnemon?: boolean;
  postPrompt?: string;
  postPromptOrder?: number;
  verbose?: boolean;
  autoRetry?: boolean;
  retryMax?: number;
  autoContinue?: boolean;
  continueMax?: number;
  continueText?: string;
  capabilityProtocol?: boolean;
  hooksDenyBypass?: boolean;
}

export declare function apply(ctx: Context, config?: PurgeConfig): void;
export declare function registerPromptSections(ctx: Context, config?: PurgeConfig): void;
export default apply;
