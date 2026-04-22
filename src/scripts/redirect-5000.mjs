import http from 'http';

http.createServer((clientReq, clientRes) => {
  const options = {
    hostname: '127.0.0.1',
    port: 3000,
    path: clientReq.url,
    method: clientReq.method,
    headers: { ...clientReq.headers, host: 'localhost:3000' },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    clientRes.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
    proxyRes.pipe(clientRes, { end: true });
  });

  proxyReq.on('error', () => {
    clientRes.writeHead(502);
    clientRes.end('App starting…');
  });

  clientReq.pipe(proxyReq, { end: true });
}).listen(5000, '0.0.0.0', () => {
  console.log('[proxy] port 5000 → 3000');
});
