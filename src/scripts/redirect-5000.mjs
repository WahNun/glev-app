import http from 'http';

http.createServer((req, res) => {
  const host = (req.headers.host || 'localhost:5000').replace(/:5000$/, ':3001');
  res.writeHead(302, { 'Location': `https://${host}${req.url}` });
  res.end();
}).listen(5000, '0.0.0.0', () => {
  console.log('[redirect] port 5000 → 3001');
});
