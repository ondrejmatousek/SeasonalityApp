// A verification server, not a production backend. Serves exported files only.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = fs.realpathSync(path.resolve(process.argv[2] || 'artifacts/static-site'));
const port = Number(process.argv[3] || 54129);
const types = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
http.createServer((request, response) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
    catch { response.writeHead(400).end(); return; }
    if (pathname === '/' || pathname === '/Seasonality') pathname = '/index.html';
    const candidate = path.resolve(root, '.' + pathname);
    if (!candidate.startsWith(root + path.sep) || !fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
        response.writeHead(404).end('Not found'); return;
    }
    const file = fs.realpathSync(candidate);
    if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    response.writeHead(200, {
        'Content-Type': types[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': /^\/data\/(prices|cot)\//.test(pathname) ? 'public, max-age=31536000, immutable' : 'no-cache',
        'X-Content-Type-Options': 'nosniff'
    });
    if (request.method === 'HEAD') response.end(); else fs.createReadStream(file).pipe(response);
}).listen(port, '127.0.0.1', () => process.stdout.write(`Static site ready: http://127.0.0.1:${port}/ (no SQL or ASP.NET)\n`));
