import { buildRequest, parseJsonObject, parseResponse, type ChatMessage } from './ai-protocol';
import { normalizeExtraction, summarize, type Catalog } from './requirements';
import { applyRanking } from './rerank';

const transcript: ChatMessage[] = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: 'Close CR-1' },
  { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'get_request', arguments: { request: 'CR-1' } }, { id: 'c2', name: 'list_staff', arguments: {} }] },
  { role: 'tool', content: '{"status":"NEW"}', toolCallId: 'c1', name: 'get_request' },
  { role: 'tool', content: '[]', toolCallId: 'c2', name: 'list_staff' },
];
const tools = [{ name: 'get_request', description: 'd', parameters: { type: 'object', properties: {} } }];

describe('AI provider protocol', () => {
  it('speaks OpenAI-compatible: stringified arguments, tool_call_id, bearer key, JSON mode', () => {
    const call = buildRequest({ provider: 'OPENAI_COMPATIBLE', baseUrl: 'https://x/v1/', model: 'm', apiKey: 'k' }, { messages: transcript, tools, json: true, temperature: 0.2, maxTokens: 100 });
    expect(call.url).toBe('https://x/v1/chat/completions');
    expect(call.headers.authorization).toBe('Bearer k');
    const msgs = call.body.messages as any[];
    expect(msgs[2].tool_calls[0]).toEqual({ id: 'c1', type: 'function', function: { name: 'get_request', arguments: '{"request":"CR-1"}' } });
    expect(msgs[2].content).toBeNull();
    expect(msgs[3]).toEqual({ role: 'tool', tool_call_id: 'c1', content: '{"status":"NEW"}' });
    expect(call.body.response_format).toEqual({ type: 'json_object' });
    expect((call.body.tools as any[])[0].function.name).toBe('get_request');
  });

  it('speaks Ollama: object arguments, tool_name, options, format json, no key header by default', () => {
    const call = buildRequest({ provider: 'OLLAMA', baseUrl: 'http://h:11434', model: 'm', apiKey: null }, { messages: transcript, json: true, temperature: 0.1, maxTokens: 50 });
    expect(call.url).toBe('http://h:11434/api/chat');
    expect(call.headers.authorization).toBeUndefined();
    const msgs = call.body.messages as any[];
    expect(msgs[2].tool_calls[0]).toEqual({ function: { name: 'get_request', arguments: { request: 'CR-1' } } });
    expect(msgs[3]).toEqual({ role: 'tool', content: '{"status":"NEW"}', tool_name: 'get_request' });
    expect(call.body).toMatchObject({ stream: false, format: 'json', options: { temperature: 0.1, num_predict: 50 } });
  });

  it('speaks Anthropic: system on top, tool_use blocks, tool results merged into one user turn', () => {
    const call = buildRequest({ provider: 'ANTHROPIC', baseUrl: 'https://api.anthropic.com', model: 'm', apiKey: 'k' }, { messages: transcript, tools, temperature: 0, maxTokens: 10 });
    expect(call.url).toBe('https://api.anthropic.com/v1/messages');
    expect(call.headers['x-api-key']).toBe('k');
    expect(call.body.system).toBe('sys');
    const msgs = call.body.messages as any[];
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(msgs[1].content).toEqual([
      { type: 'tool_use', id: 'c1', name: 'get_request', input: { request: 'CR-1' } },
      { type: 'tool_use', id: 'c2', name: 'list_staff', input: {} },
    ]);
    expect(msgs[2].content.map((b: any) => b.tool_use_id)).toEqual(['c1', 'c2']);
    expect((call.body.tools as any[])[0]).toEqual({ name: 'get_request', description: 'd', input_schema: { type: 'object', properties: {} } });
  });

  it('reads tool calls back from every provider, tolerating string or object arguments', () => {
    expect(parseResponse('OPENAI_COMPATIBLE', { choices: [{ message: { content: null, tool_calls: [{ id: 'a', function: { name: 't', arguments: '{"x":1}' } }] } }] }))
      .toEqual({ content: '', toolCalls: [{ id: 'a', name: 't', arguments: { x: 1 } }] });
    const ollama = parseResponse('OLLAMA', { message: { content: '', tool_calls: [{ function: { name: 't', arguments: { x: 2 } } }] } });
    expect(ollama.toolCalls[0]).toMatchObject({ name: 't', arguments: { x: 2 } });
    expect(ollama.toolCalls[0].id).toMatch(/^call_/);
    expect(parseResponse('ANTHROPIC', { content: [{ type: 'text', text: 'hi' }, { type: 'tool_use', id: 'u', name: 't', input: { y: 1 } }] }))
      .toEqual({ content: 'hi', toolCalls: [{ id: 'u', name: 't', arguments: { y: 1 } }] });
    expect(parseResponse('OPENAI_COMPATIBLE', { choices: [{ message: { tool_calls: [{ function: { name: 't', arguments: 'not json' } }] } }] }).toolCalls[0].arguments).toEqual({});
  });

  it('pulls a JSON object out of fenced or chatty replies, and gives up quietly otherwise', () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonObject('Sure!\n```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(parseJsonObject('Here you go: {"a":3} hope that helps')).toEqual({ a: 3 });
    expect(parseJsonObject('no json here')).toBeNull();
    expect(parseJsonObject('[1,2]')).toBeNull();
  });
});

describe('AI requirement extraction', () => {
  const catalog: Catalog = {
    skills: [{ id: 'skill-a', name: 'Dementia Care' }, { id: 'skill-b', name: 'Wound Care' }],
    languages: [{ id: 'lang-si', name: 'Sinhala' }],
    districts: [{ id: 5, name: 'Kandy', localName: 'මහනුවර' }],
  };
  const today = '2026-10-19';

  it('keeps only catalogue values, in-range numbers and sensible dates', () => {
    const { request, cityName } = normalizeExtraction(
      {
        patient: { age: '79', gender: 'FEMALE', medicalConditions: ['dementia', '', 42] },
        districtId: 5,
        city: ' Peradeniya ',
        mandatorySkillIds: ['s1', 'S9'],
        optionalSkillIds: ['S1', 'S2'],
        languageIds: ['L1', 'L1', 'X'],
        shift: 'NIGHT',
        caregiverGenderPreference: 'FEMALE',
        desiredStartDate: '2026-10-26',
        minimumExperienceYears: 3,
        dailyBudget: '5,000',
        monthlyBudget: -1,
      },
      catalog,
      today,
    );
    expect(cityName).toBe('Peradeniya');
    expect(request).toEqual({
      page: 1,
      pageSize: 20,
      patient: { age: 79, gender: 'FEMALE', medicalConditions: ['dementia'] },
      location: { districtId: 5 },
      mandatorySkillIds: ['skill-a'],
      optionalSkillIds: ['skill-b'],
      languageIds: ['lang-si'],
      shift: 'NIGHT',
      caregiverGenderPreference: 'FEMALE',
      desiredStartDate: '2026-10-26',
      minimumExperienceYears: 3,
      budget: { dailyRate: 5000 },
    });
  });

  it('drops unknown districts, invalid enums and past dates rather than guessing', () => {
    const { request } = normalizeExtraction({ districtId: 999, shift: 'MORNING', caregiverGenderPreference: 'OTHER', desiredStartDate: '2020-01-01', patient: { age: 300 } }, catalog, today);
    expect(request).toEqual({ page: 1, pageSize: 20 });
    expect(normalizeExtraction(null, catalog, today).request).toEqual({ page: 1, pageSize: 20 });
  });

  it('summarises in the visitor\'s language', () => {
    const s = summarize({ location: { districtId: 5 }, shift: 'NIGHT', patient: { age: 79 } }, catalog, 'si', null);
    expect(s.location).toEqual(['මහනුවර']);
    expect(s.care).toEqual(['රාත්‍රී රැකවරණය']);
    expect(s.patient).toEqual(['වයස අවුරුදු 79']);
  });
});

describe('AI re-ranking', () => {
  const handles = new Map([['C1', 'a'], ['C2', 'b'], ['C3', 'c']]);

  it('reorders only known candidates, keeps the rest in their original order, and caps reasons', () => {
    const r = applyRanking({ ranking: [{ id: 'c3', reason: 'x'.repeat(500) }, { id: 'C9' }, 'C3', { id: 'C1', reason: '  fits  ' }] }, handles, ['a', 'b', 'c']);
    expect(r.order).toEqual(['c', 'a', 'b']);
    expect(r.reasons.get('a')).toBe('fits');
    expect(r.reasons.get('c')).toHaveLength(200);
    expect(r.used).toBe(true);
  });

  it('falls back to the original order on an unusable reply', () => {
    expect(applyRanking({ nope: 1 }, handles, ['a', 'b', 'c'])).toEqual({ order: ['a', 'b', 'c'], reasons: new Map(), used: false });
  });
});
