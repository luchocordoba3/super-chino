// Servicios de afuera de mentira para las pruebas de punta a punta (los reales no se usan en las pruebas):
// Mercado Pago (sucursal, cajas con QR, órdenes que se pagan en la segunda consulta) y ARCA (WSAA y WSFEv1).
import { createServer } from 'node:http';

const PORT = Number(process.env.FAKE_MP_PORT ?? 3399);
const orders = new Map();
let arcaLast = 0;
let n = 0;

createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      body = {};
    }
    const send = (status, data, type = 'application/json') => {
      res.writeHead(status, { 'content-type': type });
      res.end(type === 'application/json' ? JSON.stringify(data) : data);
    };
    const path = url.pathname;
    if (path === '/health') return send(200, { ok: true });
    // ---- ARCA ----
    const soap = (inner) => send(200, `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${inner}</soap:Body></soap:Envelope>`, 'text/xml');
    if (path === '/arca/wsaa') {
      const exp = new Date(Date.now() + 12 * 3600e3).toISOString();
      const ticket = `<loginTicketResponse><header><expirationTime>${exp}</expirationTime></header><credentials><token>E2E-TOKEN</token><sign>E2E-SIGN</sign></credentials></loginTicketResponse>`;
      return soap(`<loginCmsResponse><loginCmsReturn>${ticket.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</loginCmsReturn></loginCmsResponse>`);
    }
    if (path === '/arca/wsfe') {
      const action = String(req.headers.soapaction ?? '');
      if (action.endsWith('FECompUltimoAutorizado')) return soap(`<FECompUltimoAutorizadoResponse><FECompUltimoAutorizadoResult><CbteNro>${arcaLast}</CbteNro></FECompUltimoAutorizadoResult></FECompUltimoAutorizadoResponse>`);
      if (action.endsWith('FECAESolicitar')) {
        arcaLast++;
        return soap(`<FECAESolicitarResponse><FECAESolicitarResult><FeDetResp><FECAEDetResponse><Resultado>A</Resultado><CAE>7${String(arcaLast).padStart(13, '0')}</CAE><CAEFchVto>20361231</CAEFchVto></FECAEDetResponse></FeDetResp></FECAESolicitarResult></FECAESolicitarResponse>`);
      }
      return soap('<FECompConsultarResponse><FECompConsultarResult><Errors><Err><Code>602</Code><Msg>No existen datos</Msg></Err></Errors></FECompConsultarResult></FECompConsultarResponse>');
    }
    if (path.startsWith('/qr/')) {
      return send(200, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#000"/><rect x="2" y="2" width="6" height="6" fill="#fff"/></svg>`, 'image/svg+xml');
    }
    if (!String(req.headers.authorization ?? '').startsWith('Bearer APP_USR-')) return send(401, { message: 'invalid_token' });
    if (req.method === 'GET' && path === '/users/me') return send(200, { id: 777 });
    if (req.method === 'POST' && /^\/users\/\d+\/stores$/.test(path)) return send(201, { id: 1 });
    if (req.method === 'POST' && path === '/pos') return send(201, { id: ++n, qr: { image: `http://localhost:${PORT}/qr/${body.external_id}.svg` } });
    if (req.method === 'POST' && path === '/v1/orders') {
      const id = `ORD${++n}`;
      orders.set(id, { id, status: 'created', polls: 0, body });
      return send(201, { id, status: 'created' });
    }
    const m = path.match(/^\/v1\/orders\/([^/]+)(\/cancel)?$/);
    if (m && orders.has(m[1])) {
      const o = orders.get(m[1]);
      if (m[2]) o.status = 'canceled';
      else if (++o.polls >= 2 && o.status === 'created') o.status = 'processed';
      return send(200, { id: o.id, status: o.status, transactions: { payments: [{ id: `PAY-${o.id}` }] } });
    }
    send(404, { message: 'not_found' });
  });
}).listen(PORT);
