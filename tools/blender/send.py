"""
Run Python inside the live Blender session (tools/blender/live.py) and print what it printed.

  python3 tools/blender/send.py 'print(len(body().data.vertices))'
  python3 tools/blender/send.py -f my_modelling_step.py
  python3 tools/blender/send.py --wait-body      (block until the site has sent its body)

Reads the session token from ~/.3dg-blender-token (written by live.py, readable only by you). Stdlib only.
"""
import sys, os, json, socket, base64, struct

def connect():
    token, port = open(os.path.expanduser('~/.3dg-blender-token')).read().split()
    s = socket.create_connection(('127.0.0.1', int(port)))
    key = base64.b64encode(os.urandom(16)).decode()
    s.sendall((f'GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
               f'Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n').encode())
    buf = b''
    while b'\r\n\r\n' not in buf:
        buf += s.recv(4096)
    if b' 101 ' not in buf.split(b'\r\n')[0]:
        raise SystemExit('handshake refused')
    return s, token, buf.split(b'\r\n\r\n', 1)[1]

def send(s, obj):
    data = json.dumps(obj).encode()
    n = len(data)
    mask = os.urandom(4)
    head = bytes([0x81]) + (bytes([0x80 | n]) if n < 126 else (bytes([0x80 | 126]) + struct.pack('>H', n) if n < 65536 else bytes([0x80 | 127]) + struct.pack('>Q', n)))
    s.sendall(head + mask + bytes(b ^ mask[i & 3] for i, b in enumerate(data)))

def recv(s, buf):
    while True:
        if len(buf) >= 2:
            ln, i = buf[1] & 0x7F, 2
            if ln == 126 and len(buf) >= 4: ln, i = struct.unpack('>H', buf[2:4])[0], 4
            elif ln == 127 and len(buf) >= 10: ln, i = struct.unpack('>Q', buf[2:10])[0], 10
            if ln < 126 or i > 2:
                if len(buf) >= i + ln:
                    return json.loads(buf[i:i + ln]), buf[i + ln:]
        d = s.recv(1 << 20)
        if not d:
            raise SystemExit('connection closed')
        buf += d

def main():
    a = sys.argv[1:]
    s, token, buf = connect()
    send(s, {'t': 'hello', 'token': token})
    m, buf = recv(s, buf)
    if m.get('role') != 'control':
        raise SystemExit('not accepted as control')
    if a and a[0] == '--wait-body':
        while True:
            m, buf = recv(s, buf)
            if m.get('t') == 'body':
                print('body', m['sex'], 'version', m['version']); return
    code = open(a[1]).read() if a and a[0] == '-f' else ' '.join(a)
    send(s, {'t': 'exec', 'code': code})
    while True:
        m, buf = recv(s, buf)
        if m.get('t') == 'result':
            sys.stdout.write(m['out'])
            if m['err']:
                sys.stderr.write(m['err']); sys.exit(1)
            return
        if m.get('t') == 'error':
            raise SystemExit(m['msg'])

if __name__ == '__main__':
    main()
