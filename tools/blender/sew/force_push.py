# Force a full-topology resend: clear the sent-signature cache on every site client.
for c in live.SERVER.clients:
    if c.role == 'site':
        c.sent = {}
push()
print('[push] full topology resent to', sum(1 for c in live.SERVER.clients if c.role == 'site'), 'site client(s)')
