/** A packet exercising every block type, shared by tests and the dev preview. */
const LOREM = 'Retainers work best when the price is anchored to the outcome the client '
  + 'is buying rather than the hours you spend producing it. Start from the value of '
  + 'the result, then work backwards to a number you can defend in a single sentence. ';

export function samplePacket(overrides = {}) {
  return {
    meta: {
      title: 'Positioning & Pricing — Discovery Packet',
      clientName: 'Northwind Studio',
      preparedBy: 'Jane Doe, Doe Consulting',
      dateLabel: 'September 29, 2026',
      toolsUsed: ['ChatGPT', 'Claude'],
      summary: 'Synthesis of two working sessions on retainer pricing and landing page positioning, merged from separate assistant threads.',
      footer: 'Confidential — prepared for Northwind Studio',
      includeToc: true,
      includeCover: true,
      userLabel: 'Prompt',
      assistantLabel: 'Response',
      ...overrides.meta,
    },
    threads: overrides.threads || [
      {
        id: 'chatgpt:abc',
        vendor: 'chatgpt',
        vendorLabel: 'ChatGPT',
        model: 'gpt-5-thinking',
        title: 'Retainer pricing strategy',
        url: 'https://chatgpt.com/c/abc',
        capturedAt: '2026-09-28T14:02:00.000Z',
        messages: [
          {
            id: 'm1',
            role: 'user',
            include: true,
            blocks: [{
              type: 'paragraph',
              spans: [
                { text: 'How should I price ' },
                { text: 'value-based retainers', bold: true },
                { text: ' for a boutique studio? Reference ' },
                { text: 'this pricing guide', href: 'https://example.com/pricing' },
                { text: '.' },
              ],
            }],
          },
          {
            id: 'm2',
            role: 'assistant',
            include: true,
            blocks: [
              { type: 'heading', level: 2, spans: [{ text: 'Anchor on outcomes, not hours' }] },
              { type: 'paragraph', spans: [{ text: LOREM }] },
              {
                type: 'list',
                ordered: true,
                items: [
                  { spans: [{ text: 'Name the business outcome in one sentence.' }], depth: 0 },
                  { spans: [{ text: 'Estimate its annual value to the client.' }], depth: 0 },
                  { spans: [{ text: 'Use a conservative multiple.' }], depth: 1 },
                  { spans: [{ text: 'Price the retainer at 10–15% of that value.' }], depth: 0 },
                ],
              },
              {
                type: 'code',
                language: 'python',
                code: 'def retainer(annual_value: float, share: float = 0.12) -> float:\n'
                  + '    """Monthly retainer from the annual value of the outcome."""\n'
                  + '    return round(annual_value * share / 12, -2)\n\n'
                  + 'print(retainer(480_000))  # a deliberately long line that has to wrap inside the code box to stay readable\n',
              },
              {
                type: 'quote',
                blocks: [{ type: 'paragraph', spans: [{ text: `${LOREM}${LOREM}` }] }],
              },
              { type: 'rule' },
              {
                type: 'table',
                head: [['Tier', 'Monthly', 'Scope']],
                rows: [
                  ['Starter', '$2,000', 'One workstream, async only'],
                  ['Studio', '$6,000', 'Two workstreams, weekly call'],
                  ['Partner', '$12,000', 'Unlimited scope within retainer hours'],
                ],
              },
            ],
          },
        ],
      },
      {
        id: 'claude:def',
        vendor: 'claude',
        vendorLabel: 'Claude',
        model: 'Claude Opus 5',
        title: 'Landing page copy pass',
        url: 'https://claude.ai/chat/def',
        capturedAt: '2026-09-29T09:15:00.000Z',
        messages: [
          {
            id: 'm3',
            role: 'user',
            include: true,
            blocks: [{ type: 'paragraph', spans: [{ text: 'Rewrite the hero section for the pricing page.' }] }],
          },
          {
            id: 'm4',
            role: 'assistant',
            include: true,
            blocks: [
              { type: 'paragraph', spans: [{ text: LOREM.repeat(4) }] },
              { type: 'heading', level: 3, spans: [{ text: 'Hero variants' }] },
              {
                type: 'list',
                ordered: false,
                items: [
                  { spans: [{ text: 'Outcome-first: "Ship the brand refresh in six weeks."' }], depth: 0 },
                  { spans: [{ text: 'Proof-first: "Trusted by 40 founder-led studios."' }], depth: 0 },
                ],
              },
              { type: 'paragraph', spans: [{ text: LOREM.repeat(6) }] },
            ],
          },
          {
            id: 'm5',
            role: 'assistant',
            include: false, // excluded in the studio; must not reach the packet
            blocks: [{ type: 'paragraph', spans: [{ text: 'EXCLUDED MESSAGE — should never render.' }] }],
          },
        ],
      },
    ],
  };
}
