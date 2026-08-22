/**
 * Tests for utility/helper functions
 */

function generateOrderId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let rand = '';
  for (let i = 0; i < 4; i++) rand += chars[Math.floor(Math.random() * chars.length)];
  const d = new Date();
  const ds = d.getFullYear().toString()
    + ('0' + (d.getMonth() + 1)).slice(-2)
    + ('0' + d.getDate()).slice(-2);
  return 'HXG-' + ds + '-' + rand;
}

function parseCookies(cookieHeader) {
  const cookies = {};
  const header = cookieHeader || '';
  header.split(';').forEach(c => {
    const [key, ...val] = c.split('=');
    if (key) cookies[key.trim()] = decodeURIComponent(val.join('='));
  });
  return cookies;
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
function send404(res) { sendJson(res, 404, { error: 'Not found' }); }
function send401(res) { sendJson(res, 401, { error: 'Unauthorized' }); }
function send500(res, msg) { sendJson(res, 500, { error: msg || 'Server error' }); }

describe('generateOrderId', () => {
  test('starts with HXG-', () => {
    expect(generateOrderId()).toMatch(/^HXG-/);
  });
  test('format HXG-YYYYMMDD-XXXX', () => {
    const parts = generateOrderId().split('-');
    expect(parts.length).toBe(3);
    expect(parts[0]).toBe('HXG');
    expect(parts[1]).toMatch(/^\d{8}$/);
    expect(parts[2]).toMatch(/^[A-Z0-9]{4}$/);
  });
  test('no ambiguous chars (I,O,0,1) in suffix', () => {
    for (let i = 0; i < 30; i++) {
      expect(generateOrderId().split('-')[2]).not.toMatch(/[IO01]/);
    }
  });
  test('suffix is 4 chars', () => {
    expect(generateOrderId().split('-')[2].length).toBe(4);
  });
  test('generates unique IDs', () => {
    const ids = new Set();
    for (let i = 0; i < 50; i++) ids.add(generateOrderId());
    expect(ids.size).toBe(50);
  });
  test('date part matches today', () => {
    const d = new Date();
    const expected = d.getFullYear().toString()
      + ('0' + (d.getMonth() + 1)).slice(-2)
      + ('0' + d.getDate()).slice(-2);
    expect(generateOrderId().split('-')[1]).toBe(expected);
  });
});

describe('parseCookies', () => {
  test('single cookie', () => {
    expect(parseCookies('admin_session=abc123').admin_session).toBe('abc123');
  });
  test('multiple cookies', () => {
    const r = parseCookies('foo=bar; baz=qux; admin_session=xyz');
    expect(r.foo).toBe('bar');
    expect(r.baz).toBe('qux');
    expect(r.admin_session).toBe('xyz');
  });
  test('empty string', () => {
    expect(Object.keys(parseCookies('')).length).toBe(0);
  });
  test('null', () => {
    expect(Object.keys(parseCookies(null)).length).toBe(0);
  });
  test('undefined', () => {
    expect(Object.keys(parseCookies(undefined)).length).toBe(0);
  });
  test('URL-encoded values', () => {
    expect(parseCookies('name=hello%20world').name).toBe('hello world');
  });
  test('key is trimmed', () => {
    expect(parseCookies(' key = value ')).toHaveProperty('key');
  });
  test('empty value', () => {
    expect(parseCookies('empty=').empty).toBe('');
  });
  test('value with = sign', () => {
    expect(parseCookies('token=abc=def=ghi').token).toBe('abc=def=ghi');
  });
});

describe('sendJson', () => {
  test('sets status and content-type', () => {
    const res = { writeHead: jest.fn(), end: jest.fn() };
    sendJson(res, 200, { hello: 'world' });
    expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json; charset=utf-8' });
  });
  test('serializes to JSON', () => {
    const res = { writeHead: jest.fn(), end: jest.fn() };
    sendJson(res, 200, { a: 1 });
    expect(res.end).toHaveBeenCalledWith('{"a":1}');
  });
});

describe('send404', () => {
  test('sends 404', () => {
    const res = { writeHead: jest.fn(), end: jest.fn() };
    send404(res);
    expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
    expect(JSON.parse(res.end.mock.calls[0][0]).error).toBe('Not found');
  });
});

describe('send401', () => {
  test('sends 401', () => {
    const res = { writeHead: jest.fn(), end: jest.fn() };
    send401(res);
    expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
    expect(JSON.parse(res.end.mock.calls[0][0]).error).toBe('Unauthorized');
  });
});

describe('send500', () => {
  test('default message', () => {
    const res = { writeHead: jest.fn(), end: jest.fn() };
    send500(res);
    expect(JSON.parse(res.end.mock.calls[0][0]).error).toBe('Server error');
  });
  test('custom message', () => {
    const res = { writeHead: jest.fn(), end: jest.fn() };
    send500(res, 'Custom');
    expect(JSON.parse(res.end.mock.calls[0][0]).error).toBe('Custom');
  });
});
