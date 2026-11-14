/** A downloaded dictionary is checked before it is installed, and a failed download is tried again. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dictFromJson, loadDict, tx } from './l10n';

describe('dictFromJson', () => {
  it('keeps the entries that are texts and drops the rest', () => {
    expect(dictFromJson({ Close: 'Schließen', Open: 3, Help: null, Back: { de: 'Zurück' }, Next: ['Weiter'], '': '' }))
      .toEqual({ Close: 'Schließen', '': '' });
  });

  it('takes nothing but an object for a dictionary', () => {
    for (const json of [null, undefined, 'Close', 7, true, [], ['Schließen']]) {
      expect(dictFromJson(json)).toBeNull();
    }
    expect(dictFromJson({})).toEqual({});
  });
});

describe('loadDict', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('installs nothing when the download fails, and downloads again when asked again', async () => {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response('gone', { status: 404 }))
      .mockResolvedValueOnce(new Response('["not", "a", "dictionary"]'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ Close: 'Закрыть', Open: 5 })));
    vi.stubGlobal('fetch', fetchMock);

    for (let attempt = 1; attempt <= 3; attempt++) {
      await loadDict('ru');
      expect(fetchMock).toHaveBeenCalledTimes(attempt);
      expect(tx('ru', 'Kapat', 'Close')).toBe('Close');
    }

    await loadDict('ru');
    expect(tx('ru', 'Kapat', 'Close')).toBe('Закрыть');
    expect(tx('ru', 'Aç', 'Open')).toBe('Open');

    await loadDict('ru');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('asks once while a download is under way', async () => {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>().mockResolvedValue(new Response('{"Close":"Chiudi"}'));
    vi.stubGlobal('fetch', fetchMock);
    await Promise.all([loadDict('it'), loadDict('it')]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(tx('it', 'Kapat', 'Close')).toBe('Chiudi');
  });
});
