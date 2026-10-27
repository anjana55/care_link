import { BOM, csvCell, headerKey, parseCsv, parseDate, parseEnum, parseList, readCsv, toCsv } from './csv.util';
import { decodeUpload } from './data-transfer.controller';

describe('csv.util', () => {
  describe('writing', () => {
    it('starts with a byte-order mark so Excel reads Sinhala and Tamil as UTF-8', () => {
      const csv = toCsv([{ header: 'Name', value: (r: { n: string }) => r.n }], [{ n: 'සුනිල්' }, { n: 'சுனில்' }]);
      expect(csv.startsWith(BOM)).toBe(true);
      expect(csv).toBe(`${BOM}Name\r\nසුනිල්\r\nசுனில்\r\n`);
    });

    it('quotes separators, quotes and line breaks', () => {
      expect(csvCell('12, Temple Road')).toBe('"12, Temple Road"');
      expect(csvCell('say "hi"')).toBe('"say ""hi"""');
      expect(csvCell('line 1\nline 2')).toBe('"line 1\nline 2"');
      expect(csvCell(null)).toBe('');
      expect(csvCell(42)).toBe('42');
    });

    it('stops a spreadsheet running a cell as a formula, but leaves phone numbers alone', () => {
      expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
      expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
      expect(csvCell('+cmd')).toBe("'+cmd");
      expect(csvCell('+94 77 123 4567')).toBe('+94 77 123 4567');
      expect(csvCell('-5')).toBe('-5');
    });
  });

  describe('reading', () => {
    it('round-trips what it writes', () => {
      const rows = [{ a: 'x, y', b: 'he said "no"\nthen left' }];
      const csv = toCsv(
        [
          { header: 'A', value: (r: (typeof rows)[0]) => r.a },
          { header: 'B', value: (r: (typeof rows)[0]) => r.b },
        ],
        rows,
      );
      expect(parseCsv(csv)).toEqual([
        ['A', 'B'],
        ['x, y', 'he said "no"\nthen left'],
      ]);
    });

    it('accepts semicolons, CRLF and blank lines', () => {
      expect(parseCsv('Full name;NIC\r\nAmal;123\r\n\r\n;\r\nNimal;456')).toEqual([
        ['Full name', 'NIC'],
        ['Amal', '123'],
        ['Nimal', '456'],
      ]);
    });

    it('keys columns loosely and numbers rows as a spreadsheet does', () => {
      const { headers, records } = readCsv('Full Name,date_of_birth\n Amal , 1990-01-02\nNimal,');
      expect(headers).toEqual(['fullname', 'dateofbirth']);
      expect(records).toEqual([
        { rowNumber: 2, values: { fullname: 'Amal', dateofbirth: '1990-01-02' } },
        { rowNumber: 3, values: { fullname: 'Nimal', dateofbirth: '' } },
      ]);
      expect(headerKey('Height (inches)')).toBe('heightinches');
    });

    it('decodes UTF-8 with a BOM, UTF-16 and Windows-1252 uploads', () => {
      expect(readCsv(decodeUpload(Buffer.from(`${BOM}Name\nසුනිල්`, 'utf8'))).records[0].values.name).toBe('සුනිල්');
      expect(decodeUpload(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Name\nAmal', 'utf16le')]))).toBe('Name\nAmal');
      expect(decodeUpload(Buffer.from([0x43, 0x61, 0x66, 0xe9]))).toBe('Café');
    });
  });

  describe('values', () => {
    it('reads the date formats spreadsheets produce, and rejects impossible dates', () => {
      expect(parseDate('1990-05-14')).toBe('1990-05-14');
      expect(parseDate('1990/5/4')).toBe('1990-05-04');
      expect(parseDate('14/05/1990')).toBe('1990-05-14');
      expect(parseDate('4.5.1990')).toBe('1990-05-04');
      expect(parseDate('1990-05-14T00:00:00.000Z')).toBe('1990-05-14');
      expect(parseDate('31/02/1990')).toBeNull();
      expect(parseDate('05/14/1990')).toBeNull();
      expect(parseDate('yesterday')).toBeNull();
    });

    it('matches options by code or by the words a person types', () => {
      const methods = ['PHONE_CALL', 'WHATSAPP', 'EMAIL'] as const;
      expect(parseEnum('PHONE_CALL', methods)).toBe('PHONE_CALL');
      expect(parseEnum('Phone call', methods)).toBe('PHONE_CALL');
      expect(parseEnum('phone-call', methods)).toBe('PHONE_CALL');
      expect(parseEnum('WhatsApp', methods)).toBe('WHATSAPP');
      expect(parseEnum('fax', methods)).toBeNull();
      expect(parseEnum('live in 24h', ['DAY', 'NIGHT', 'LIVE_IN_24H'] as const)).toBe('LIVE_IN_24H');
    });

    it('splits list cells on ; , or |', () => {
      expect(parseList('Sinhala; English,Tamil | ')).toEqual(['Sinhala', 'English', 'Tamil']);
      expect(parseList('')).toEqual([]);
    });
  });
});
