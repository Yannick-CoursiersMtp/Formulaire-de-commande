const http = require('http');
const fs = require('fs');
const { parse } = require('querystring');

const PORT = process.env.PORT || 3000;
const ORDERS_FILE = './orders.json';

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 10; // max requests per window per IP
const requests = new Map();
const cleanupTimers = new Map();

function scheduleCleanup(ip) {
  if (cleanupTimers.has(ip)) {
    clearTimeout(cleanupTimers.get(ip));
  }
  const timer = setTimeout(() => {
    const timestamps = requests.get(ip);
    if (!timestamps) return;
    const windowStart = Date.now() - RATE_LIMIT_WINDOW_MS;
    const recent = timestamps.filter(ts => ts > windowStart);
    if (recent.length === 0) {
      requests.delete(ip);
      cleanupTimers.delete(ip);
    } else {
      requests.set(ip, recent);
      scheduleCleanup(ip);
    }
  }, RATE_LIMIT_WINDOW_MS);
  cleanupTimers.set(ip, timer);
}

function isRateLimited(ip) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = requests.get(ip) || [];
  const recent = timestamps.filter(ts => ts > windowStart);

  if (recent.length === 0) {
    requests.delete(ip);
  }

  recent.push(now);
  requests.set(ip, recent);
  scheduleCleanup(ip);

  return recent.length > RATE_LIMIT_MAX;
}

function saveOrder(data) {
  return fs.promises.readFile(ORDERS_FILE, 'utf8')
    .catch(() => '[]')
    .then(JSON.parse)
    .then(orders => {
      orders.push({ ...data, receivedAt: new Date().toISOString() });
      return fs.promises.writeFile(ORDERS_FILE, JSON.stringify(orders, null, 2));
    });
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/orders') {
    const forwardedFor = req.headers['x-forwarded-for'];
    const ip = forwardedFor ? forwardedFor.split(',')[0].trim() : req.socket.remoteAddress;
    if (isRateLimited(ip)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many requests' }));
      return;
    }
    const contentType = req.headers['content-type'];
    if (contentType !== 'application/x-www-form-urlencoded') {
      res.writeHead(415, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unsupported Media Type' }));
      return;
    }

    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) req.socket.destroy();
    });
    req.on('end', () => {
      const data = parse(body);
      if (data.nickname) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Spam detected' }));
        return;
      }

      saveOrder(data)
        .then(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
        })
        .catch(err => {
          console.error(err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Server error' }));
        });
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
