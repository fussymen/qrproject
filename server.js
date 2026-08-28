/**
 * 卡票二维码 - 自动登录服务
 *
 * 功能:
 * 1. Token 持久化 (auth.json) - 首次登录后自动保存
 * 2. 服务端 API 签名 - 浏览器无需知道签名算法
 * 3. SMS 登录端点 - 发送验证码 + 验证登录
 * 4. 卡票列表 + 二维码自动获取
 * 5. WebSocket 代理转发
 * 6. 静态文件服务
 *
 * 用法: node server.js [端口号]
 * 默认端口: 3000
 */

var http = require('http');
var https = require('https');
var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var url = require('url');

var PORT = process.env.PORT || process.argv[2] || 3000;
var API_HOST = 'api.ldzhichang.cn';
var WS_HOST = 'ws.ldzhichang.cn';

// ==================== API 签名配置 ====================
var SEC = '1171620cbf7724ba7fbd3af8fa11bf62';
var SEED = 7;
var CID = '6925c09d59a009d4b56f24ba';
var APP_ID = 'wxc5b43057147aff05';
var VERSION = '1.0.0';

// ==================== auth.json 持久化 ====================
var AUTH_FILE = path.join(process.env.DATA_DIR || __dirname, 'auth.json');

function readAuth() {
  try {
    var data = fs.readFileSync(AUTH_FILE, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return null;
  }
}

function writeAuth(auth) {
  auth.savedAt = new Date().toISOString();
  fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), 'utf8');
  console.log('[AUTH] Token saved for uid=' + auth.uid + ', phone=' + auth.phone);
}

// ==================== API 签名算法 ====================

function md5(str) {
  return crypto.createHash('md5').update(str, 'utf8').digest('hex');
}

function generateDynamicKey(t) {
  var timeWindow = Math.floor(t / 300);
  var dynamicValue = (SEED * timeWindow + 13) * 17;
  return String(dynamicValue);
}

function signSuffix(t) {
  return '&key=' + SEC + generateDynamicKey(t) + '&t=' + t;
}

function generateRandom(n) {
  var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  var result = '';
  for (var i = 0; i < n; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateRandomInt1() {
  return Math.floor(Math.random() * 10);
}

function formatParams(params) {
  if (!params) return '';
  var p = [];
  for (var k in params) {
    if (params[k] !== '' && params[k] !== undefined && params[k] !== null) {
      if (Array.isArray(params[k])) {
        p.push(k + '=' + params[k]);
      } else {
        p.push(k + '=' + encodeURIComponent(params[k]).replace(/'/g, ''));
      }
    }
  }
  return p.join('&');
}

function buildHeaders(data, token) {
  var t = Math.floor(Date.now() / 1000);
  var sign = md5(data + signSuffix(t));
  var r1 = generateRandomInt1();
  if (r1 < 1) r1 = 5;
  var randomStr = generateRandom(3);

  var headers = {
    'Content-Type': 'application/json',
    'x-req-key': 'wxmp',
    'x-req-val': randomStr + String(r1) + sign,
    'x-req-time': String(t * r1),
    'x-tenant': CID,
    'x-mp-id': APP_ID,
    'x-mp-v': VERSION
  };
  if (token) headers['x-token'] = token;
  return headers;
}

// ==================== API 请求函数 ====================

function apiRequest(apiPath, params, method, token) {
  return new Promise(function(resolve, reject) {
    method = (method || 'GET').toUpperCase();
    var fullPath = apiPath;
    var data = '';

    if (method === 'GET' || method === 'DELETE') {
      if (params) {
        var qs = formatParams(params);
        if (qs) {
          fullPath += (fullPath.indexOf('?') >= 0 ? '&' : '?') + qs;
          data = qs;
        }
      }
    } else {
      if (params) {
        data = JSON.stringify(params);
      }
    }

    var headers = buildHeaders(data, token);
    headers['Host'] = API_HOST;

    var options = {
      hostname: API_HOST,
      port: 443,
      path: fullPath,
      method: method,
      headers: headers
    };

    var startTime = Date.now();

    var req = https.request(options, function(res) {
      var body = '';
      res.on('data', function(chunk) { body += chunk; });
      res.on('end', function() {
        var elapsed = Date.now() - startTime;
        var parsed;
        try {
          parsed = JSON.parse(body);
        } catch (e) {
          parsed = body;
        }
        console.log('[API] ' + method + ' ' + fullPath + ' -> ' + res.statusCode + ' (' + elapsed + 'ms)');
        resolve({ statusCode: res.statusCode, data: parsed, raw: body });
      });
    });

    req.on('error', function(err) {
      console.error('[API] ERROR ' + method + ' ' + fullPath + ': ' + err.message);
      reject(err);
    });

    if (data && method !== 'GET' && method !== 'DELETE') {
      req.write(data);
    }
    req.end();
  });
}

// ==================== HTTP 路由处理 ====================

var MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise(function(resolve) {
    var body = '';
    req.on('data', function(chunk) { body += chunk; });
    req.on('end', function() {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve({});
      }
    });
  });
}

var server = http.createServer(function(req, res) {
  var parsedUrl = url.parse(req.url, true);
  var pathname = parsedUrl.pathname;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ==================== API 路由 ====================

  // GET /api/status - 检查 token 状态
  if (pathname === '/api/status' && req.method === 'GET') {
    var auth = readAuth();
    if (!auth || !auth.token) {
      return sendJSON(res, 200, { loggedIn: false, message: 'No token' });
    }
    // 验证 token 有效性 - 调用 passcodes API
    apiRequest('/ump/v1/users/' + auth.uid + '/passcodes', {}, 'GET', auth.token)
      .then(function(result) {
        if (result.statusCode === 200) {
          sendJSON(res, 200, {
            loggedIn: true,
            uid: auth.uid,
            phone: auth.phone,
            passcodes: result.data
          });
        } else if (result.statusCode === 401 || result.statusCode === 403) {
          sendJSON(res, 200, { loggedIn: false, message: 'Token expired' });
        } else {
          sendJSON(res, 200, { loggedIn: false, message: 'Token invalid', raw: result.data });
        }
      })
      .catch(function(err) {
        sendJSON(res, 500, { error: err.message });
      });
    return;
  }

  // POST /api/login/sms - 发送验证码
  if (pathname === '/api/login/sms' && req.method === 'POST') {
    readBody(req).then(function(body) {
      var phone = body.phone;
      if (!phone) return sendJSON(res, 400, { error: 'phone required' });

      apiRequest('/ump/v1/sms', { phone: phone, type: 1 }, 'POST', null)
        .then(function(result) {
          sendJSON(res, result.statusCode, result.data);
        })
        .catch(function(err) {
          sendJSON(res, 502, { error: err.message });
        });
    });
    return;
  }

  // POST /api/login/verify - 验证码登录
  if (pathname === '/api/login/verify' && req.method === 'POST') {
    readBody(req).then(function(body) {
      var phone = body.phone;
      var code = body.code;
      if (!phone || !code) return sendJSON(res, 400, { error: 'phone and code required' });

      // 尝试 SMS 登录 (不带 iv/encryptedData)
      var params = {
        phone: phone,
        identifyCode: code
      };

      apiRequest('/ump/v1/users', params, 'POST', null)
        .then(function(result) {
          if (result.statusCode === 200 || result.statusCode === 201) {
            var data = result.data;
            if (data && data.data && data.data.sessionToken) {
              // 保存 token
              var auth = {
                token: data.data.sessionToken,
                uid: data.data.user ? data.data.user.uid : '',
                phone: phone,
                user: data.data.user || {}
              };
              writeAuth(auth);
              return sendJSON(res, 200, {
                success: true,
                uid: auth.uid,
                phone: phone
              });
            }
          }
          sendJSON(res, result.statusCode, result.data);
        })
        .catch(function(err) {
          sendJSON(res, 502, { error: err.message });
        });
    });
    return;
  }

  // POST /api/login/token - 手动输入 token (备用方案)
  if (pathname === '/api/login/token' && req.method === 'POST') {
    readBody(req).then(function(body) {
      var token = body.token;
      var uid = body.uid;
      if (!token || !uid) return sendJSON(res, 400, { error: 'token and uid required' });

      // 验证 token
      apiRequest('/ump/v1/users/' + uid + '/passcodes', {}, 'GET', token)
        .then(function(result) {
          if (result.statusCode === 200) {
            var auth = {
              token: token,
              uid: uid,
              phone: body.phone || 'manual'
            };
            writeAuth(auth);
            sendJSON(res, 200, { success: true, uid: uid });
          } else {
            sendJSON(res, 401, { error: 'Token invalid', statusCode: result.statusCode });
          }
        })
        .catch(function(err) {
          sendJSON(res, 502, { error: err.message });
        });
    });
    return;
  }

  // GET /api/passcodes - 获取卡票列表
  if (pathname === '/api/passcodes' && req.method === 'GET') {
    var auth = readAuth();
    if (!auth || !auth.token) return sendJSON(res, 401, { error: 'Not logged in' });

    apiRequest('/ump/v1/users/' + auth.uid + '/passcodes', {}, 'GET', auth.token)
      .then(function(result) {
        sendJSON(res, result.statusCode, result.data);
      })
      .catch(function(err) {
        sendJSON(res, 502, { error: err.message });
      });
    return;
  }

  // GET /api/qrcode?id=xx&type=xx - 获取二维码
  if (pathname === '/api/qrcode' && req.method === 'GET') {
    var auth = readAuth();
    if (!auth || !auth.token) return sendJSON(res, 401, { error: 'Not logged in' });

    var id = parsedUrl.query.id;
    var type = parsedUrl.query.type;
    if (!id || !type) return sendJSON(res, 400, { error: 'id and type required' });

    apiRequest('/ump/v1/passcodes/' + id + '/qrcode?type=' + type, {}, 'GET', auth.token)
      .then(function(result) {
        sendJSON(res, result.statusCode, result.data);
      })
      .catch(function(err) {
        sendJSON(res, 502, { error: err.message });
      });
    return;
  }

  // POST /api/logout - 清除 token
  if (pathname === '/api/logout' && req.method === 'POST') {
    try {
      fs.unlinkSync(AUTH_FILE);
      sendJSON(res, 200, { success: true });
    } catch (e) {
      sendJSON(res, 200, { success: true });
    }
    return;
  }

  // ==================== 静态文件 ====================
  var filePath = pathname;
  if (filePath === '/' || filePath === '') filePath = '/index.html';

  var fullPath = path.join(__dirname, filePath);
  var ext = path.extname(fullPath);

  fs.readFile(fullPath, function(err, data) {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// ==================== WebSocket 代理 ====================
server.on('upgrade', function(req, socket, head) {
  var parsedUrl = url.parse(req.url, true);

  if (parsedUrl.pathname === '/ws') {
    var auth = readAuth();
    var token = auth ? auth.token : '';
    var wsPath = '/v1/wxmp?x-token=' + (token || '');

    var tlsSocket = require('tls').connect({
      host: WS_HOST,
      port: 443,
      servername: WS_HOST
    }, function() {
      var key = req.headers['sec-websocket-key'] || Buffer.from(Math.random().toString()).toString('base64');
      var requestLines = [
        'GET ' + wsPath + ' HTTP/1.1',
        'Host: ' + WS_HOST,
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Key: ' + key,
        'Sec-WebSocket-Version: 13',
        'Origin: https://servicewechat.com',
        '',
        ''
      ];
      tlsSocket.write(requestLines.join('\r\n'));
    });

    var upgraded = false;

    tlsSocket.on('data', function(chunk) {
      if (!upgraded) {
        var responseText = chunk.toString('utf8');
        if (responseText.indexOf('101') === 9) {
          upgraded = true;
          var acceptMatch = responseText.match(/Sec-WebSocket-Accept:\s*(.+)/i);
          var responseLines = [
            'HTTP/1.1 101 Switching Protocols',
            'Upgrade: websocket',
            'Connection: Upgrade',
            'Sec-WebSocket-Accept: ' + (acceptMatch ? acceptMatch[1].trim() : ''),
            '',
            ''
          ];
          socket.write(responseLines.join('\r\n'));

          var headerEnd = responseText.indexOf('\r\n\r\n');
          if (headerEnd >= 0 && headerEnd + 4 < chunk.length) {
            socket.write(chunk.slice(headerEnd + 4));
          }
          console.log('[WS] Connected to ' + WS_HOST);
          return;
        }
      }
      if (upgraded) socket.write(chunk);
    });

    socket.on('data', function(chunk) {
      if (upgraded) tlsSocket.write(chunk);
    });

    tlsSocket.on('error', function(err) {
      console.error('[WS] Proxy error:', err.message);
      socket.destroy();
    });

    socket.on('error', function() { tlsSocket.destroy(); });
    socket.on('close', function() { tlsSocket.destroy(); });
    tlsSocket.on('close', function() { socket.destroy(); });
  } else {
    socket.destroy();
  }
});

// ==================== 启动 ====================
server.listen(PORT, '0.0.0.0', function() {
  var auth = readAuth();
  console.log('');
  console.log('========================================');
  console.log('  Card QR Code Service');
  console.log('========================================');
  console.log('');
  console.log('  URL: http://0.0.0.0:' + PORT + '  (bound to all interfaces)');
  console.log('');
  if (auth && auth.token) {
    console.log('  Token: FOUND (uid=' + auth.uid + ', phone=' + auth.phone + ')');
    console.log('  Saved: ' + (auth.savedAt || 'unknown'));
    console.log('  -> Open browser to see QR codes directly');
  } else {
    console.log('  Token: NOT FOUND');
    console.log('  -> Open browser to login via SMS');
  }
  console.log('');
  console.log('  Endpoints:');
  console.log('    GET  /api/status      - Check auth status');
  console.log('    POST /api/login/sms   - Send SMS code');
  console.log('    POST /api/login/verify- Verify SMS & login');
  console.log('    POST /api/login/token - Manual token input');
  console.log('    GET  /api/passcodes   - Get passcode list');
  console.log('    GET  /api/qrcode      - Get QR code content');
  console.log('    POST /api/logout      - Clear token');
  console.log('    WS   /ws              - WebSocket proxy');
  console.log('');
  console.log('  Press Ctrl+C to stop');
  console.log('');
});
