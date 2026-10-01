// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsFieldState, SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import { ToolsConnectionsCard, type ToolsConnectionsCardProps } from '../src/client/page.tsx'
import type { CardState } from '../src/client/controller.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const shell: SettingsFormShell = {
  available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false,
}
const field = (text = ''): SettingsFieldState => ({ text, overridden: false, invalid: false })

function buildState(): CardState {
  return {
    ...shell,
    braveEnabled: field(), braveApiKeyRef: field(), braveBaseURL: field(),
    tavilyEnabled: field(), tavilyApiKeyRef: field(), tavilyBaseURL: field(),
    maxResults: field('8'),
    firecrawlEnabled: field(), firecrawlApiKeyRef: field(), firecrawlBaseURL: field(),
    firecrawlRequestTimeoutMs: field(), firecrawlMaxResponseBytes: field(), firecrawlMaxMarkdownChars: field(),
    braveKey: field(), tavilyKey: field(), firecrawlKey: field(),
    braveKeyConfigured: false, braveKeyWritable: true,
    tavilyKeyConfigured: false, tavilyKeyWritable: true,
    firecrawlKeyConfigured: false, firecrawlKeyWritable: true,
  }
}

function renderCard() {
  const state = buildState()
  const store = createSnapshotStore(state)
  const props = {
    t: (key: keyof typeof en) => en[key],
    useToolsConnections: bindSnapshotSelector(store),
    edit: () => {}, resetField: () => {}, save: () => {}, discard: () => {},
  } as unknown as ToolsConnectionsCardProps
  render(<ToolsConnectionsCard {...props} />)
}

describe('Tools & connections detail page layout', () => {
  it('groups providers and keeps each provider card inside a constrained content section', () => {
    renderCard()
    expect(screen.getByRole('heading', { name: en.brave })).toBeDefined()
    expect(screen.getByRole('heading', { name: en.firecrawl })).toBeDefined()
    expect(screen.getByRole('heading', { name: en.tavily })).toBeDefined()
    expect(screen.getByRole('heading', { name: en.provider })).toBeDefined()
  })

  it('renders provider switch and secret field for every configured provider', () => {
    renderCard()
    const switches = screen.getAllByRole('switch')
    const labels = switches.map(switchEl => switchEl.getAttribute('aria-label')).filter(Boolean)
    expect(labels).toContain(en.braveEnabled)
    expect(labels).toContain(en.tavilyEnabled)
    expect(labels).toContain(en.firecrawlEnabled)
    expect(screen.getAllByLabelText(en.apiKey).length).toBeGreaterThanOrEqual(3)
  })
})
