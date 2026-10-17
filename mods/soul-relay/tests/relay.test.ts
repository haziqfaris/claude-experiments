import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

const USAGE = {
  input_tokens: 1200,
  output_tokens: 300,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
}

// Stand-ins for the engine's own answers to what the mod registers and draws.
function engineBottom(on: On) {
  on('tool.register', () => ({ value: { name: 'mcp__soul-relay__delegate' } }) as never)
  on('agent.register', ($, e) => ({ value: { agent: `soul-relay:${e.name}` } }) as never)
  on('command.register', () => ({ value: {} }) as never)
  on('ui.status', () => ({ value: undefined }))
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
      posted.push(String(e.init?.body ?? ''))
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
      text: '[soul-relay task abc123 from payments-api session=boss-session]\nList the TODOs in src/.',
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
    expect(JSON.stringify(sends[0]!.to)).toContain('boss-session')
    expect(sends[0]!.text).toContain('[soul-relay result abc123 from haiku-1 model=claude-haiku-5-5 in=1200 out=300')
    expect(sends[0]!.text).toContain('Found 4 TODOs')
  })
})
