import { randomUUID } from 'node:crypto';
import forge from 'node-forge';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app';
import { prisma } from '../src/db';
import { settleInvoices } from '../src/services/arca';
import { type App, client, type Client, type Owner, registerOwner, resetDb } from './helpers';

let app: App;
let owner: Owner;
let pos: Client;

// Certificado de prueba (en ARCA real lo da "Administración de certificados digitales").
function makeCert(cn = 'almacen-test') {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
  const attrs = [{ name: 'commonName', value: cn }, { name: 'serialNumber', value: 'CUIT 20123456786' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { certPem: forge.pki.certificateToPem(cert), keyPem: forge.pki.privateKeyToPem(keys.privateKey) };
}
const CERT = makeCert();
const OTHER = makeCert('otro');

/** ARCA de mentira: WSAA y WSFEv1 con respuestas SOAP como las reales. */
const arca = { wsaa: 0, requests: [] as string[], last: 41, mode: 'ok' as 'ok' | 'reject' | 'network', lookup: null as null | { cae: string; total: string; doc: string } };
function fakeFetch(input: string | URL | Request, init: RequestInit = {}) {
  const url = String(input);
  const body = String(init.body ?? '');
  const action = String((init.headers as Record<string, string>)?.soapaction ?? '');
  const xml = (s: string) => Promise.resolve(new Response(`<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${s}</soap:Body></soap:Envelope>`, { status: 200 }));
  if (url.includes('LoginCms')) {
    arca.wsaa++;
    const cms = body.match(/<wsaa:in0>([^<]+)<\/wsaa:in0>/)![1];
    // Es un CMS (PKCS#7) firmado que lleva adentro el pedido de acceso para wsfe.
    const der = forge.util.decode64(cms);
    expect(() => forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(der))).not.toThrow();
    expect(der).toContain('<service>wsfe</service>');
    const ticket = `<loginTicketResponse><header><expirationTime>${new Date(Date.now() + 12 * 3_600_000).toISOString()}</expirationTime></header><credentials><token>TOKEN-${arca.wsaa}</token><sign>SIGN-${arca.wsaa}</sign></credentials></loginTicketResponse>`;
    return xml(`<loginCmsResponse><loginCmsReturn>${ticket.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</loginCmsReturn></loginCmsResponse>`);
  }
  arca.requests.push(`${action}\n${body}`);
  if (action.endsWith('FECompUltimoAutorizado')) return xml(`<FECompUltimoAutorizadoResponse><FECompUltimoAutorizadoResult><PtoVta>3</PtoVta><CbteTipo>11</CbteTipo><CbteNro>${arca.last}</CbteNro></FECompUltimoAutorizadoResult></FECompUltimoAutorizadoResponse>`);
  if (action.endsWith('FECompConsultar')) {
    return arca.lookup
      ? xml(`<FECompConsultarResponse><FECompConsultarResult><ResultGet><DocNro>${arca.lookup.doc}</DocNro><ImpTotal>${arca.lookup.total}</ImpTotal><CodAutorizacion>${arca.lookup.cae}</CodAutorizacion><FchVto>20261010</FchVto></ResultGet></FECompConsultarResult></FECompConsultarResponse>`)
      : xml(`<FECompConsultarResponse><FECompConsultarResult><Errors><Err><Code>602</Code><Msg>No existen datos</Msg></Err></Errors></FECompConsultarResult></FECompConsultarResponse>`);
  }
  if (action.endsWith('FECAESolicitar')) {
    if (arca.mode === 'network') return Promise.reject(new TypeError('fetch failed'));
    if (arca.mode === 'reject') {
      return xml(`<FECAESolicitarResponse><FECAESolicitarResult><FeDetResp><FECAEDetResponse><Resultado>R</Resultado><Observaciones><Obs><Code>10015</Code><Msg>DocNro invalido</Msg></Obs></Observaciones></FECAEDetResponse></FeDetResp></FECAESolicitarResult></FECAESolicitarResponse>`);
    }
    arca.last++;
    return xml(`<FECAESolicitarResponse><FECAESolicitarResult><FeCabResp><Resultado>A</Resultado></FeCabResp><FeDetResp><FECAEDetResponse><Resultado>A</Resultado><CAE>7412345678901${arca.last % 10}</CAE><CAEFchVto>20261005</CAEFchVto></FECAEDetResponse></FeDetResp></FECAESolicitarResult></FECAESolicitarResponse>`);
  }
  return Promise.resolve(new Response('not found', { status: 404 }));
}

beforeAll(async () => {
  app = await buildApp();
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetDb();
  Object.assign(arca, { wsaa: 0, requests: [], last: 41, mode: 'ok', lookup: null });
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
  owner = await registerOwner(app);
  const { token } = (await owner.api.post('/pos/devices', { name: 'Caja 1' })).body;
  pos = client(app, undefined, { 'x-device-token': token });
});
afterEach(() => vi.unstubAllGlobals());

const fiscal = (taxStatus: 'MONOTRIBUTO' | 'RESPONSABLE_INSCRIPTO') =>
  owner.api.put('/fiscal', { cuit: '20123456786', businessName: 'Carlos Pérez', address: 'Mitre 123, Rosario', taxStatus, pointOfSale: 3, ...CERT });
async function sale(total = 1210) {
  const p = (await owner.api.post('/stock/quick', { barcode: String(Math.random()).slice(2, 10), product: { name: 'Vino', price: total }, qty: 10 })).body.product.id;
  const id = randomUUID();
  await pos.post('/pos/sync', {
    events: [
      { id, type: 'SALE', userId: owner.ownerId, occurredAt: new Date().toISOString(), items: [{ productId: p, qty: 1, unitPrice: total, listPrice: total }], payments: [{ method: 'CASH', amount: total }], total },
    ],
  });
  return id;
}
async function askInvoice(saleId: string, extra: Record<string, unknown> = {}) {
  const r = await pos.post('/pos/sync', {
    events: [{ id: randomUUID(), type: 'INVOICE_REQUEST', userId: owner.ownerId, occurredAt: new Date().toISOString(), saleId, docType: 99, docNumber: '0', ...extra }],
  });
  await settleInvoices();
  return r.body.results[0];
}
const lastRequest = (method: string) => arca.requests.filter((r) => r.startsWith(`http://ar.gov.afip.dif.FEV1/${method}`)).at(-1) ?? '';

describe('ARCA: datos fiscales', () => {
  it('valida el certificado, no lo devuelve y prueba la conexión', async () => {
    const base = { cuit: '20123456786', businessName: 'Carlos Pérez', taxStatus: 'MONOTRIBUTO', pointOfSale: 3 };
    expect((await owner.api.put('/fiscal', base)).body.error).toBe('certificate_required');
    expect((await owner.api.put('/fiscal', { ...base, certPem: 'x', keyPem: 'y' })).body.error).toBe('bad_certificate');
    expect((await owner.api.put('/fiscal', { ...base, certPem: CERT.certPem, keyPem: OTHER.keyPem })).body.error).toBe('certificate_key_mismatch');
    expect((await fiscal('MONOTRIBUTO')).status).toBe(200);
    const saved = await prisma.fiscalConfig.findUniqueOrThrow({ where: { storeId: owner.storeId } });
    expect(saved.keyPem).not.toContain('PRIVATE KEY');
    const view = (await owner.api.get('/fiscal')).body;
    expect(view).toMatchObject({ cuit: '20123456786', taxStatus: 'MONOTRIBUTO', pointOfSale: 3, production: false });
    expect(view.certificate.subject).toContain('almacen-test');
    expect(JSON.stringify(view)).not.toContain('PRIVATE');
    expect((await owner.api.post('/fiscal/test')).body).toEqual({ ok: true, last: { C: 41 } });
    expect((await pos.get('/pos/bootstrap')).body.store.invoicing).toBe('MONOTRIBUTO');
  });
});

describe('ARCA: factura a pedido del cliente', () => {
  it('monotributo: factura C a consumidor final desde la caja; el acceso se reutiliza', async () => {
    await fiscal('MONOTRIBUTO');
    const s1 = await sale(1210);
    expect((await askInvoice(s1)).status).toBe('ok');
    const inv = (await pos.get(`/pos/invoices/by-sale/${s1}`)).body;
    expect(inv).toMatchObject({ status: 'AUTHORIZED', letter: 'C', number: 42, code: '0003-00000042', cae: '74123456789012', total: 1210 });
    const req = lastRequest('FECAESolicitar');
    expect(req).toContain('<ar:CbteTipo>11</ar:CbteTipo>');
    expect(req).toContain('<ar:DocTipo>99</ar:DocTipo><ar:DocNro>0</ar:DocNro><ar:CbteDesde>42</ar:CbteDesde>');
    expect(req).toContain('<ar:ImpTotal>1210.00</ar:ImpTotal><ar:ImpTotConc>0</ar:ImpTotConc><ar:ImpNeto>1210.00</ar:ImpNeto>');
    expect(req).toContain('<ar:CondicionIVAReceptorId>5</ar:CondicionIVAReceptorId>');
    expect(req).not.toContain('<ar:Iva>');
    expect(req).toContain('<ar:Token>TOKEN-1</ar:Token>');

    const s2 = await sale(500);
    await askInvoice(s2, { docType: 96, docNumber: '30.123.456', customerName: 'Ana' });
    expect((await pos.get(`/pos/invoices/by-sale/${s2}`)).body).toMatchObject({ status: 'AUTHORIZED', number: 43, docType: 96, docNumber: '30123456' });
    expect(arca.wsaa).toBe(1);

    // La factura para mandar por WhatsApp, con el QR de ARCA.
    const pub = (await client(app).get(`/public/invoices/${(await prisma.invoice.findUniqueOrThrow({ where: { saleId: s1 } })).publicToken}`)).body;
    expect(pub).toMatchObject({ letter: 'C', issuer: { cuit: '20123456786', businessName: 'Carlos Pérez' }, items: [{ name: 'Vino', qty: 1, total: 1210 }] });
    const qr = JSON.parse(Buffer.from(new URL(pub.qr).searchParams.get('p')!, 'base64').toString());
    expect(qr).toMatchObject({ ver: 1, cuit: 20123456786, ptoVta: 3, tipoCmp: 11, nroCmp: 42, importe: 1210, tipoDocRec: 99, tipoCodAut: 'E', codAut: 74123456789012 });
  });

  it('responsable inscripto: B con el IVA discriminado a consumidor final; A si el cliente da su CUIT', async () => {
    await fiscal('RESPONSABLE_INSCRIPTO');
    const b = await sale(1210);
    await askInvoice(b);
    expect((await pos.get(`/pos/invoices/by-sale/${b}`)).body).toMatchObject({ letter: 'B', status: 'AUTHORIZED' });
    let req = lastRequest('FECAESolicitar');
    expect(req).toContain('<ar:CbteTipo>6</ar:CbteTipo>');
    expect(req).toContain('<ar:ImpNeto>1000.00</ar:ImpNeto><ar:ImpOpEx>0</ar:ImpOpEx><ar:ImpTrib>0</ar:ImpTrib><ar:ImpIVA>210.00</ar:ImpIVA>');
    expect(req).toContain('<ar:Iva><ar:AlicIva><ar:Id>5</ar:Id><ar:BaseImp>1000.00</ar:BaseImp><ar:Importe>210.00</ar:Importe></ar:AlicIva></ar:Iva>');

    const a = await sale(2420);
    await askInvoice(a, { docType: 80, docNumber: '30-71234567-1', customerVat: 1, customerName: 'Bar SRL' });
    expect((await pos.get(`/pos/invoices/by-sale/${a}`)).body).toMatchObject({ letter: 'A', status: 'AUTHORIZED' });
    req = lastRequest('FECAESolicitar');
    expect(req).toContain('<ar:CbteTipo>1</ar:CbteTipo>');
    expect(req).toContain('<ar:DocTipo>80</ar:DocTipo><ar:DocNro>30712345671</ar:DocNro>');
    expect(req).toContain('<ar:CondicionIVAReceptorId>1</ar:CondicionIVAReceptorId>');
  });

  it('si ARCA rechaza queda con el motivo y se reintenta; si se cortó la respuesta no se duplica', async () => {
    await fiscal('MONOTRIBUTO');
    const s1 = await sale(1000);
    arca.mode = 'reject';
    await askInvoice(s1);
    let inv = await prisma.invoice.findUniqueOrThrow({ where: { saleId: s1 } });
    expect(inv).toMatchObject({ status: 'ERROR', number: 42 });
    expect(inv.error).toContain('DocNro invalido');
    arca.mode = 'ok';
    expect((await owner.api.post(`/invoices/${inv.id}/retry`)).body).toMatchObject({ status: 'AUTHORIZED', number: 42 });

    // Se cortó la respuesta de ARCA, pero la factura 43 sí quedó autorizada: al reintentar se consulta y se usa esa.
    const s2 = await sale(700);
    arca.mode = 'network';
    await askInvoice(s2);
    inv = await prisma.invoice.findUniqueOrThrow({ where: { saleId: s2 } });
    expect(inv).toMatchObject({ status: 'ERROR', number: 43 });
    arca.lookup = { cae: '75000000000043', total: '700.00', doc: '0' };
    arca.mode = 'ok';
    const before = arca.requests.filter((r) => r.includes('FECAESolicitar')).length;
    expect((await owner.api.post(`/invoices/${inv.id}/retry`)).body).toMatchObject({ status: 'AUTHORIZED', number: 43, cae: '75000000000043' });
    expect(arca.requests.filter((r) => r.includes('FECAESolicitar')).length).toBe(before);
  });

  it('no factura ventas anuladas, CUIT mal cargado ni sin datos fiscales', async () => {
    const s = await sale(100);
    expect(await askInvoice(s)).toMatchObject({ status: 'rejected', error: 'fiscal_not_configured' });
    await fiscal('MONOTRIBUTO');
    expect(await askInvoice(s, { docType: 80, docNumber: '123' })).toMatchObject({ status: 'rejected', error: 'bad_cuit' });
    await pos.post('/pos/sync', { events: [{ id: randomUUID(), type: 'SALE_VOIDED', userId: owner.ownerId, occurredAt: new Date().toISOString(), saleId: s }] });
    expect(await askInvoice(s)).toMatchObject({ status: 'rejected', error: 'sale_voided' });
  });
});
