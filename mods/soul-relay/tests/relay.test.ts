import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

const USAGE = {
  input_tokens: 1200,
  output_tokens: 300,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
}

// Stand-ins for the engine's own answers to what the mod registers and draws.
function engineBottom(on: On, { status = true } = {}) {
  on('tool.register', () => ({ value: { name: 'mcp__soul-relay__delegate' } }) as never)
  on('agent.register', ($, e) => ({ value: { agent: `soul-relay:${e.name}` } }) as never)
  on('command.register', () => ({ value: {} }) as never)
  if (status) on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.receive', ($, e) => ({ text: e.text }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
}

describe('soul-relay', () => {
  test('delegate tool answers from the cheaper model and reports the saving', async ($, on) => {
    const asked: { model: string; prompt: string }[] = []
    const posted: string[] = []
    mock.store(on)
    mock.clock(on)
    engineBottom(on)
    on('session.model', () => ({ value: 'claude-opus-5-5' }))
    on('session.id', () => ({ value: 'boss-session' }))
    on('session.cwd', () => ({ value: '/work/payments-api' }))
    on('session.start', () => ({ cwd: '/work/payments-api' }))
    on('model.complete', ($, e) => {
      asked.push({ model: e.model, prompt: e.prompt })
      return { value: { isAnswered: true, text: 'Three bullet summary.', usage: USAGE } }
    })
    on('http.fetch', ($, e) => {
      // Only delegation reports; the soul also looks up this chat's project.
      if (String(e.url).endsWith('/api/delegations')) posted.push(String(e.init?.body ?? ''))
      return { value: { status: 200, ok: true, headers: {}, text: '{}' } }
    })

    await $.session.start({ source: 'startup', cwd: '/work/payments-api', surface: null } as never)
    const ran = await $.tool.call({
      tool: 'mcp__soul-relay__delegate',
      task: 'Summarize this in three bullets.',
      context: 'A long changelog…',
    } as never)

    expect(String(ran.result)).toContain('Three bullet summary.')
    expect(asked[0]?.model).toBe('claude-haiku-5-5')
    expect(asked[0]?.prompt).toContain('A long changelog')
    expect(posted).toHaveLength(1)
    const body = JSON.parse(posted[0]!) as { saved: number; route: string; model: string }
    expect(body.route).toBe('model')
    expect(body.model).toBe('claude-haiku-5-5')
    expect(body.saved).toBeGreaterThan(0)
  })

  test('a worker sends its final reply back to the session that asked', async ($, on) => {
    const sends: { to: unknown; text: string }[] = []
    mock.store(on)
    mock.clock(on)
    engineBottom(on)
    on('session.model', () => ({ value: 'claude-haiku-5-5' }))
    on('session.id', () => ({ value: 'worker-session' }))
    on('session.cwd', () => ({ value: '/work/payments-api' }))
    on('session.start', () => ({ cwd: '/work/payments-api' }))
    on('session.send', ($, e) => {
      sends.push({ to: e.to, text: e.text })
      return { isDelivered: true }
    })

    await $.session.start({ source: 'startup', cwd: '/work/payments-api', surface: null } as never)
    await $.command.run({
      command: 'soul-worker',
      args: 'haiku-1',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    } as never)
    await $.session.receive({
      origin: { kind: 'peer', plugin: 'soul-relay' },
      // As Claude Code delivers it: wrapped in the cross-session envelope.
      text:
        'Another Claude session sent a message:\n<cross-session-message from="uds:/tmp/boss.sock" from-name="payments-api-01">\n' +
        '[soul-relay task abc123 from payments-api session=boss-session]\nList the TODOs in src/.\n</cross-session-message>',
    } as never)
    await $.turn.complete({
      answer: 'Found 4 TODOs in src/handlers.',
      durationMs: 1200,
      isAborted: false,
      turnId: 't1',
      reason: 'answer',
      usage: { ...USAGE, model: 'claude-haiku-5-5' },
    } as never)

    await $.command.run({
      command: 'soul-worker',
      args: 'off',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    } as never)

    expect(sends).toHaveLength(1)
    expect(sends[0]!.to).toBe('uds:/tmp/boss.sock')
    expect(sends[0]!.text).toContain('[soul-relay result abc123 from haiku-1 model=claude-haiku-5-5 in=1200 out=300')
    expect(sends[0]!.text).toContain('Found 4 TODOs')
  })

  test('two chats sending to one busy worker both get the report back', async ($, on) => {
    const sends: { to: unknown; text: string }[] = []
    mock.store(on)
    mock.clock(on)
    engineBottom(on)
    on('session.model', () => ({ value: 'claude-haiku-5-5' }))
    on('session.id', () => ({ value: 'worker-session' }))
    on('session.cwd', () => ({ value: '/work/payments-api' }))
    on('session.start', () => ({ cwd: '/work/payments-api' }))
    on('session.send', ($, e) => {
      sends.push({ to: e.to, text: e.text })
      return { isDelivered: true }
    })
    const run = (args: string) =>
      $.command.run({ command: 'soul-worker', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as never)
    const deliver = (id: string, sock: string) =>
      $.session.receive({
        origin: { kind: 'peer', plugin: 'soul-relay' },
        text: `Another Claude session sent a message:\n<cross-session-message from="${sock}">\n[soul-relay task ${id} from chat session=s-${id}]\nDo it.\n</cross-session-message>`,
      } as never)

    await $.session.start({ source: 'startup', cwd: '/work/payments-api', surface: null } as never)
    await run('haiku-1')
    await deliver('t1', 'uds:/tmp/a.sock')
    await deliver('t2', 'uds:/tmp/b.sock')
    await $.turn.complete({
      answer: 'Both done.',
      durationMs: 900,
      isAborted: false,
      turnId: 't9',
      reason: 'answer',
      usage: { ...USAGE, model: 'claude-haiku-5-5' },
    } as never)
    await run('off')

    expect(sends.map(s => s.to)).toEqual(['uds:/tmp/a.sock', 'uds:/tmp/b.sock'])
    expect(sends[0]!.text).toContain('in=1200')
    expect(sends[1]!.text).toContain('in=0 out=0')
  })
})

// A stand-in for the Soul Engine hub: answers by path, records what was asked.
function fakeHub(on: On, asked: string[]) {
  on('http.fetch', ($, e) => {
    const url = String(e.url)
    asked.push(`${e.init?.method ?? 'GET'} ${url.replace('http://127.0.0.1:7777', '')}${e.init?.body ? ` ${e.init.body}` : ''}`)
    let body: unknown = { ok: true }
    if (url.includes('/api/soul/scope')) body = { project: { name: 'Payments', repos: ['payments-api', 'payments-web'] } }
    else if (url.includes('/api/soul/inventory')) body = { text: 'Payments / payments-api · Resend (e-mail API): RESEND_API_KEY (src/mail.ts:4)' }
    else if (url.includes('/api/outbox')) body = asked.filter((a) => a.includes('/api/outbox')).length === 1 ? [{ id: 'm1', text: '/soul-roadmap please draft the roadmap' }] : []
    else if (url.includes('/api/soul/routes')) {
      const steps = (JSON.parse(String(e.init?.body)) as { steps: string[] }).steps
      body = {
        routes: steps.map(s => ({ step: s, model: /find/i.test(s) ? 'haiku' : 'opus', where: /find/i.test(s) ? 'haiku worker' : 'this chat', why: 'rule', instruction: null })),
        text: `Suggested routes (Payments)\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
      }
    }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } }
  })
}

describe('the soul', () => {
  test('soul tools answer for this chat\'s project from the hub', async ($, on) => {
    const asked: string[] = []
    mock.store(on)
    mock.clock(on)
    engineBottom(on)
    fakeHub(on, asked)
    on('session.model', () => ({ value: 'claude-opus-5-5' }))
    on('session.id', () => ({ value: 'boss-session' }))
    on('session.cwd', () => ({ value: '/work/payments-api' }))
    on('session.start', () => ({ cwd: '/work/payments-api' }))

    await $.session.start({ source: 'startup', cwd: '/work/payments-api', surface: null } as never)
    const ran = await $.tool.call({ tool: 'mcp__soul-relay__soul_inventory', query: 'resend' } as never)

    expect(String(ran.result)).toContain('RESEND_API_KEY')
    expect(asked).toContain('GET /api/soul/scope?cwd=%2Fwork%2Fpayments-api')
    expect(asked).toContain('GET /api/soul/inventory?project=Payments&q=resend')
  })

  test('a plan the chat writes gets suggested routes, and nothing is sent', async ($, on) => {
    const asked: string[] = []
    const statuses: (string | undefined)[] = []
    mock.store(on)
    mock.clock(on)
    engineBottom(on, { status: false })
    fakeHub(on, asked)
    on('ui.status', ($, e) => {
      statuses.push((e as unknown as { text?: string }).text)
      return { value: undefined }
    })
    on('tool.call', () => ({ result: 'Todos updated' }))
    on('session.model', () => ({ value: 'claude-opus-5-5' }))
    on('session.id', () => ({ value: 'boss-session' }))
    on('session.cwd', () => ({ value: '/work/payments-api' }))
    on('session.start', () => ({ cwd: '/work/payments-api' }))

    await $.session.start({ source: 'startup', cwd: '/work/payments-api', surface: null } as never)
    await $.tool.call({
      tool: 'TodoWrite',
      todos: [
        { content: 'Find every place invoices are built', status: 'pending' },
        { content: 'Design the export format', status: 'pending' },
      ],
    } as never)
    await $.turn.complete({ answer: 'Plan ready.', durationMs: 900, isAborted: false, turnId: 't1', reason: 'answer', usage: { ...USAGE, model: 'claude-opus-5-5' } } as never)
    const shown = await $.command.run({ command: 'soul-routes', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as never)

    const posts = asked.filter(a => a.startsWith('POST /api/soul/routes'))
    expect(posts).toHaveLength(1)
    expect(posts[0]).toContain('Find every place invoices are built')
    expect(String((shown as { text?: string }).text)).toContain('Suggested routes (Payments)')
    expect(statuses.some(s => s?.includes('1/2 steps fit cheaper models'))).toBe(true)
    expect(asked.some(a => a.includes('/api/delegations'))).toBe(false)
  })

  test('a message sent from the dashboard reaches this chat once', async ($, on) => {
    const asked: string[] = []
    const sends: { to: unknown; text: string }[] = []
    mock.store(on)
    const clock = mock.clock(on)
    engineBottom(on)
    fakeHub(on, asked)
    on('session.model', () => ({ value: 'claude-opus-5-5' }))
    on('session.id', () => ({ value: 'boss-session' }))
    on('session.cwd', () => ({ value: '/work/payments-api' }))
    on('session.start', () => ({ cwd: '/work/payments-api' }))
    on('session.send', ($, e) => {
      sends.push({ to: e.to, text: e.text })
      return { isDelivered: true }
    })

    await $.session.start({ source: 'startup', cwd: '/work/payments-api', surface: null } as never)
    await clock.advance(5_000)
    await clock.advance(5_000)

    expect(asked.filter(a => a.startsWith('GET /api/outbox?session=boss-session')).length).toBe(2)
    expect(sends).toHaveLength(1)
    expect(sends[0]!.to).toBe('boss-session')
    expect(sends[0]!.text).toBe('[Soul Engine] /soul-roadmap please draft the roadmap')
  })
})
