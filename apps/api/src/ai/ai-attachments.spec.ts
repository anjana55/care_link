import { AttachmentNotSupportedError, buildRequest, type ChatAttachment } from './ai-protocol';

const png: ChatAttachment = { mediaType: 'image/png', base64: 'iVBORw0K', filename: 'nic.png' };
const pdf: ChatAttachment = { mediaType: 'application/pdf', base64: 'JVBERi0x', filename: 'police.pdf' };
const req = (attachments: ChatAttachment[]) => ({ messages: [{ role: 'system' as const, content: 'Read it' }, { role: 'user' as const, content: 'What does it say?', attachments }], temperature: 0, maxTokens: 300, json: true });
const cfg = (provider: 'OLLAMA' | 'OPENAI_COMPATIBLE' | 'ANTHROPIC') => ({ provider, baseUrl: 'http://model', model: 'm', apiKey: null });

describe('files shown to a model', () => {
  it('Ollama: images on the message; a PDF is refused before anything is sent', () => {
    const body = buildRequest(cfg('OLLAMA'), req([png])).body as { messages: { images?: string[] }[] };
    expect(body.messages[1]).toEqual({ role: 'user', content: 'What does it say?', images: ['iVBORw0K'] });
    expect(() => buildRequest(cfg('OLLAMA'), req([pdf]))).toThrow(AttachmentNotSupportedError);
  });

  it('OpenAI-compatible: an image as a data URL, a PDF as a file part', () => {
    const body = buildRequest(cfg('OPENAI_COMPATIBLE'), req([png, pdf])).body as { messages: { content: unknown }[] };
    expect(body.messages[1].content).toEqual([
      { type: 'text', text: 'What does it say?' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0K' } },
      { type: 'file', file: { filename: 'police.pdf', file_data: 'data:application/pdf;base64,JVBERi0x' } },
    ]);
  });

  it('Anthropic: image and document blocks before the question', () => {
    const body = buildRequest(cfg('ANTHROPIC'), req([png, pdf])).body as { messages: { content: unknown }[] };
    expect(body.messages[0].content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0K' } },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0x' } },
      { type: 'text', text: 'What does it say?' },
    ]);
  });

  it('leaves plain messages as they were', () => {
    const body = buildRequest(cfg('OPENAI_COMPATIBLE'), req([])).body as { messages: { content: unknown }[] };
    expect(body.messages[1]).toEqual({ role: 'user', content: 'What does it say?' });
  });
});
