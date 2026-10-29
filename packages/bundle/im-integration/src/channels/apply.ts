/** Register and drop official IM CLI tools when Settings change. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Config } from '../config.ts'
import type { ImCliChannel } from '../cli-paths.ts'
import { executeImCliAuth } from './auth.ts'
import { executeDingtalkCli } from './dingtalk/cli.ts'
import { executeLarkCli } from './lark/cli.ts'
import { executeWecomCli } from './wecom/cli.ts'
import {
  activeCliChannels,
  cliToolName,
  larkPluginLoaded,
} from './registry.ts'
import { toolTimeoutMs } from './runner.ts'

const processSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    exitCode: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
    signal: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
    timedOut: { type: 'boolean', required: true },
    stdout: { type: 'string', required: true },
    stderr: { type: 'string', required: true },
  },
} as const

interface CliText {
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
}

function renderCliText(_args: unknown, value: CliText) {
  return [{
    type: 'text' as const,
    text: [value.stdout, value.stderr, value.timedOut ? '[timed out]' : ''].filter(Boolean).join('\n'),
  }]
}

const TOOL_COPY: Record<ImCliChannel, { description: string; argumentDescription: string; title: string; present: string }> = {
  lark: {
    description: 'Run the official Lark/Feishu CLI using the configured application. Use ["auth", "status"] to check this bundle’s CLI configuration. Use im_cli_auth for login.',
    argumentDescription: 'Arguments after lark-cli, for example ["calendar", "+agenda"]. Do not pass --profile, login, or upgrade.',
    title: 'lark-cli',
    present: 'Official Lark/Feishu CLI',
  },
  wecom: {
    description: 'Run the official WeCom CLI (@wecom/cli). Use ["auth", "show"] to inspect login. Use im_cli_auth for QR login.',
    argumentDescription: 'Arguments after wecom-cli. Do not pass auth init, login, upgrade, or QR flags.',
    title: 'wecom-cli',
    present: 'Official WeCom CLI',
  },
  dingtalk: {
    description: 'Run the official DingTalk workspace CLI (dws). Use ["auth", "status"] to inspect login. Use im_cli_auth for device login.',
    argumentDescription: 'Arguments after dws. Do not pass auth login, upgrade, --device, or client flags.',
    title: 'dws',
    present: 'Official DingTalk workspace CLI',
  },
}

function registrationKey(config: Config, larkLoaded: boolean): string {
  return [
    activeCliChannels(config, larkLoaded).join(','),
    String(config.cliTimeoutMs.get()),
    String(config.cliGraceMs.get()),
  ].join('|')
}

function defineChannelTool(ctx: Context, config: Config, channel: ImCliChannel, timeoutMs: number) {
  const copy = TOOL_COPY[channel]
  return defineTool({
    name: cliToolName(channel),
    description: copy.description,
    parameters: {
      arguments: {
        type: 'array',
        required: true,
        description: copy.argumentDescription,
        items: { type: 'string' },
      },
    },
    output: { schema: processSchema, render: renderCliText },
    timeoutMs,
    execute: (toolArgs, exec) => {
      if (channel === 'lark') return executeLarkCli(ctx, config, toolArgs.arguments, exec.signal)
      if (channel === 'wecom') return executeWecomCli(ctx, config, toolArgs.arguments, exec.signal)
      return executeDingtalkCli(ctx, config, toolArgs.arguments, exec.signal)
    },
    presentCall: toolArgs => ({
      card: 'terminal',
      title: `${copy.title} ${toolArgs.arguments.join(' ')}`,
      description: copy.present,
    }),
  })
}

function defineAuthTool(ctx: Context, config: Config, timeoutMs: number) {
  return defineTool({
    name: 'im_cli_auth',
    description: 'Start official IM CLI login and return the QR path, URL, or device code. The login process keeps running after this tool returns.',
    parameters: {
      channel: {
        type: 'string',
        required: true,
        enum: ['lark', 'wecom', 'dingtalk'],
        description: 'Which official CLI to authenticate: lark, wecom, or dingtalk.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ...processSchema.properties,
          channel: { type: 'string', required: true },
          url: { type: 'string', required: true },
          deviceCode: { type: 'string', required: true },
          userCode: { type: 'string', required: true },
          qrCodePath: { type: 'string', required: true },
          pending: { type: 'boolean', required: true },
        },
      },
      render: renderCliText,
    },
    timeoutMs,
    execute: (toolArgs, exec) => executeImCliAuth(
      ctx,
      config,
      toolArgs.channel,
      exec.signal,
      activeCliChannels(config, larkPluginLoaded(ctx)).includes(toolArgs.channel),
    ),
    presentCall: toolArgs => ({
      card: 'terminal',
      title: `im_cli_auth ${toolArgs.channel}`,
      description: 'Official IM CLI login',
    }),
  })
}

/**
 * Register `lark_cli`, `wecom_cli`, `dingtalk_cli`, and `im_cli_auth` while Settings allow them.
 * Volatile updates and loader config updates rebuild the set. An already loaded dsh-lark-integration
 * suppresses `lark_cli` and logs one warning.
 * @param ctx - host context with `tools` and `subprocess`.
 * @param config - live IM configuration.
 * @returns nothing. The registration lives in an effect.
 */
export function applyImCli(ctx: Context, config: Config): void {
  ctx.effect(() => {
    let dispose!: () => void
    let ready = false
    let registeredKey = ''
    let warned = false
    const sync = (): void => {
      const larkLoaded = larkPluginLoaded(ctx)
      const larkRequested = config.cliEnabled.get()
        && config.larkCliEnabled.get()
        && config.larkAppId.get().trim() !== ''
      if (larkRequested && larkLoaded && !warned) {
        ctx.logger.warn('im: skipping lark_cli because @deepseek-ai/dsh-lark-integration is also loaded')
        warned = true
      }
      const key = registrationKey(config, larkLoaded)
      if (ready && key === registeredKey) return
      if (ready) dispose()
      const stops: Array<() => void> = []
      const channels = activeCliChannels(config, larkLoaded)
      const timeoutMs = toolTimeoutMs(config.cliTimeoutMs.get(), config.cliGraceMs.get(), 5)
      for (const channel of channels) stops.push(ctx.tools.register(defineChannelTool(ctx, config, channel, timeoutMs)))
      if (channels.length > 0) stops.push(ctx.tools.register(defineAuthTool(ctx, config, timeoutMs)))
      dispose = () => {
        for (const stop of stops) stop()
      }
      ready = true
      registeredKey = key
    }
    const stopVolatile = ctx.on('loader/volatile-update', sync)
    const stopConfig = ctx.on('loader/config-update', sync)
    sync()
    return () => {
      stopVolatile()
      stopConfig()
      dispose()
    }
  }, 'im: official CLI tools')
}
