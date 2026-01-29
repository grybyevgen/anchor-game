const crypto = require('crypto');

// Простая in-memory идемпотентность с TTL.
// Важно: в многопроцессном/мульти-инстанс деплое ключи не шарятся между инстансами.

const STORE = new Map();
const DEFAULT_TTL_MS = 60_000;
const MAX_ENTRIES = 5_000;

function nowMs() {
  return Date.now();
}

function cleanup() {
  const now = nowMs();
  for (const [key, entry] of STORE.entries()) {
    if (!entry || entry.expiresAt <= now) {
      STORE.delete(key);
    }
  }

  // Простая защита от роста памяти
  if (STORE.size > MAX_ENTRIES) {
    // Удаляем самые “старые” по expiresAt
    const entries = Array.from(STORE.entries()).sort((a, b) => (a[1]?.expiresAt || 0) - (b[1]?.expiresAt || 0));
    const toRemove = STORE.size - MAX_ENTRIES;
    for (let i = 0; i < toRemove; i++) {
      STORE.delete(entries[i][0]);
    }
  }
}

function safeBodyHash(body) {
  try {
    const str = body ? JSON.stringify(body) : '';
    return crypto.createHash('sha256').update(str).digest('hex');
  } catch {
    return 'nohash';
  }
}

/**
 * Middleware: Idempotency-Key / X-Idempotency-Key
 * - повтор с тем же ключом → вернём уже сохранённый ответ (или 409, если запрос ещё выполняется)
 */
function idempotency(options = {}) {
  const ttlMs = typeof options.ttlMs === 'number' ? options.ttlMs : DEFAULT_TTL_MS;

  return function idempotencyMiddleware(req, res, next) {
    const idKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];
    if (!idKey) return next();

    cleanup();

    const key = `${req.method}:${req.originalUrl}:${String(idKey)}:${safeBodyHash(req.body)}`;
    const existing = STORE.get(key);
    const now = nowMs();

    if (existing && existing.expiresAt > now) {
      if (existing.inFlight) {
        return res.status(409).json({
          success: false,
          error: 'Операция уже выполняется. Подождите пару секунд и обновите данные.',
          code: 'IN_PROGRESS',
        });
      }
      return res.status(existing.statusCode || 200).json(existing.body);
    }

    // Регистрируем in-flight
    STORE.set(key, { inFlight: true, expiresAt: now + ttlMs });

    // Перехватываем res.status/res.json, чтобы сохранить ответ
    const originalStatus = res.status.bind(res);
    const originalJson = res.json.bind(res);
    let capturedStatus = 200;

    res.status = (code) => {
      capturedStatus = code;
      return originalStatus(code);
    };

    res.json = (body) => {
      STORE.set(key, {
        inFlight: false,
        expiresAt: nowMs() + ttlMs,
        statusCode: capturedStatus || res.statusCode || 200,
        body,
      });
      return originalJson(body);
    };

    res.on('finish', () => {
      const cur = STORE.get(key);
      if (cur && cur.inFlight) {
        // Ответ ушёл не через res.json (редко), но “разлочим” ключ
        STORE.set(key, { ...cur, inFlight: false, expiresAt: nowMs() + ttlMs, statusCode: res.statusCode || 200 });
      }
    });

    next();
  };
}

module.exports = { idempotency };

