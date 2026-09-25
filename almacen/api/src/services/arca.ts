/**
 * Factura electrónica de ARCA, integrada directo (sin servicios de terceros):
 * WSAA da el acceso (pedido firmado en CMS con el certificado del local) y WSFEv1 autoriza cada comprobante
 * (CAE). Una factura por vez por local, así no se pisan los números.
 */
import forge from 'node-forge';
import { round2 } from '@almacen/shared';
import { type Db, num, prisma } from '../db';
import { localYMD } from '../domain/dates';
import { env } from '../env';
import { decrypt, encrypt, randomToken } from '../lib/crypto';
import { HttpError } from '../lib/http';

const URLS = {
  wsaa: { homo: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms', prod: 'https://wsaa.afip.gov.ar/ws/services/LoginCms' },
  wsfe: { homo: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx', prod: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx' },
};
const wsaaUrl = (prod: boolean) => env.ARCA_WSAA_URL || URLS.wsaa[prod ? 'prod' : 'homo'];
const wsfeUrl = (prod: boolean) => env.ARCA_WSFE_URL || URLS.wsfe[prod ? 'prod' : 'homo'];

export class ArcaError extends Error {}

export const INVOICE_LETTER: Record<number, string> = { 1: 'A', 6: 'B', 11: 'C' };
/** Códigos de alícuota de IVA de ARCA. */
const VAT_ID: Record<string, number> = { '0': 3, '10.5': 4, '21': 5, '27': 6, '5': 8, '2.5': 9 };

const esc = (s: string | number) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const tag = (xml: string, name: string) => xml.match(new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)</(?:\\w+:)?${name}>`))?.[1];
const tags = (xml: string, name: string) => [...xml.matchAll(new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'g'))].map((m) => m[1]);

async function soap(url: string, action: string | null, body: string) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'text/xml; charset=utf-8', ...(action ? { soapaction: action } : { soapaction: '""' }) },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  const fault = tag(text, 'faultstring');
  if (fault) throw new ArcaError(unesc(fault).trim());
  if (!res.ok) throw new ArcaError(`HTTP ${res.status}`);
  return text;
}

// ---------- Certificado ----------

/** Revisa que el certificado y la clave sean válidos y se correspondan; devuelve vencimiento y a quién pertenece. */
export function checkCertificate(certPem: string, keyPem: string) {
  let cert: forge.pki.Certificate;
  let key: forge.pki.rsa.PrivateKey;
  try {
    cert = forge.pki.certificateFromPem(certPem);
    key = forge.pki.privateKeyFromPem(keyPem) as forge.pki.rsa.PrivateKey;
  } catch {
    throw new HttpError(400, 'bad_certificate');
  }
  const pub = cert.publicKey as forge.pki.rsa.PublicKey;
  if (pub.n.compareTo(key.n) !== 0) throw new HttpError(400, 'certificate_key_mismatch');
  const subject = cert.subject.attributes.map((a) => `${a.shortName ?? a.name}=${a.value}`).join(', ');
  return { notAfter: cert.validity.notAfter, subject };
}

/** Pedido de acceso (TRA) firmado en CMS con SHA-256, en base64. */
export function signTra(certPem: string, keyPem: string, service = 'wsfe', now = new Date()) {
  const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const tra =
    `<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header>` +
    `<uniqueId>${Math.floor(now.getTime() / 1000)}</uniqueId>` +
    `<generationTime>${iso(new Date(now.getTime() - 10 * 60_000))}</generationTime>` +
    `<expirationTime>${iso(new Date(now.getTime() + 10 * 60_000))}</expirationTime>` +
    `</header><service>${service}</service></loginTicketRequest>`;
  const cert = forge.pki.certificateFromPem(certPem);
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, 'utf8');
  p7.addCertificate(cert);
  p7.addSigner({
    key: forge.pki.privateKeyFromPem(keyPem),
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: now as unknown as string },
    ],
  });
  p7.sign();
  return forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());
}

// ---------- Acceso (WSAA) ----------

interface Cfg {
  storeId: string;
  cuit: string;
  production: boolean;
  certPem: string;
  keyPem: string;
  wsaaToken: string | null;
  wsaaSign: string | null;
  wsaaExpires: Date | null;
}
type Auth = { token: string; sign: string; cuit: string };

async function access(cfg: Cfg): Promise<Auth> {
  if (cfg.wsaaToken && cfg.wsaaSign && cfg.wsaaExpires && cfg.wsaaExpires.getTime() - Date.now() > 10 * 60_000) {
    return { token: decrypt(cfg.wsaaToken), sign: decrypt(cfg.wsaaSign), cuit: cfg.cuit };
  }
  const cms = signTra(decrypt(cfg.certPem), decrypt(cfg.keyPem));
  const xml = await soap(
    wsaaUrl(cfg.production),
    null,
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov"><soapenv:Header/><soapenv:Body><wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>`,
  );
  const ticket = unesc(tag(xml, 'loginCmsReturn') ?? '');
  const token = tag(ticket, 'token');
  const sign = tag(ticket, 'sign');
  const expires = tag(ticket, 'expirationTime');
  if (!token || !sign) throw new ArcaError('WSAA: respuesta sin token');
  await prisma.fiscalConfig.update({
    where: { storeId: cfg.storeId },
    data: { wsaaToken: encrypt(token), wsaaSign: encrypt(sign), wsaaExpires: expires ? new Date(expires) : new Date(Date.now() + 11 * 3_600_000) },
  });
  return { token, sign, cuit: cfg.cuit };
}

// ---------- Comprobantes (WSFEv1) ----------

const authXml = (a: Auth) => `<ar:Auth><ar:Token>${esc(a.token)}</ar:Token><ar:Sign>${esc(a.sign)}</ar:Sign><ar:Cuit>${esc(a.cuit)}</ar:Cuit></ar:Auth>`;
const envelope = (inner: string) =>
  `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/"><soap:Body>${inner}</soap:Body></soap:Envelope>`;
const wsfe = (cfg: Cfg, method: string, inner: string) => soap(wsfeUrl(cfg.production), `http://ar.gov.afip.dif.FEV1/${method}`, envelope(`<ar:${method}>${inner}</ar:${method}>`));

function wsfeErrors(xml: string) {
  const errs = tags(xml, 'Err').map((e) => `${tag(e, 'Code')}: ${unesc(tag(e, 'Msg') ?? '')}`);
  const obs = tags(xml, 'Obs').map((e) => `${tag(e, 'Code')}: ${unesc(tag(e, 'Msg') ?? '')}`);
  return { errs, obs };
}

async function lastNumber(cfg: Cfg, auth: Auth, pointOfSale: number, type: number) {
  const xml = await wsfe(cfg, 'FECompUltimoAutorizado', `${authXml(auth)}<ar:PtoVta>${pointOfSale}</ar:PtoVta><ar:CbteTipo>${type}</ar:CbteTipo>`);
  const { errs } = wsfeErrors(xml);
  const n = tag(xml, 'CbteNro');
  if (n == null) throw new ArcaError(errs.join(' · ') || 'WSFE: sin número');
  return Number(n);
}

/** Si un pedido anterior se cortó, puede que ARCA sí lo haya autorizado: se consulta antes de pedir otro número. */
async function lookup(cfg: Cfg, auth: Auth, pointOfSale: number, type: number, number: number) {
  const xml = await wsfe(cfg, 'FECompConsultar', `${authXml(auth)}<ar:FeCompConsReq><ar:CbteTipo>${type}</ar:CbteTipo><ar:CbteNro>${number}</ar:CbteNro><ar:PtoVta>${pointOfSale}</ar:PtoVta></ar:FeCompConsReq>`);
  const cae = tag(xml, 'CodAutorizacion');
  return cae ? { cae, due: tag(xml, 'FchVto') ?? '', total: Number(tag(xml, 'ImpTotal') ?? 0), docNumber: tag(xml, 'DocNro') ?? '' } : null;
}

const ymdToDate = (s: string) => new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T12:00:00Z`);

// ---------- Cola por local ----------

const queues = new Map<string, Promise<unknown>>();
function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const next = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(fn);
  queues.set(key, next);
  void next.finally(() => queues.get(key) === next && queues.delete(key)).catch(() => undefined);
  return next;
}
/** Espera las facturas en curso (para tests). */
export const settleInvoices = () => Promise.allSettled([...queues.values()]);

// ---------- Factura de una venta ----------

/** Tipo de factura según quién factura y quién compra. */
export function invoiceType(taxStatus: string, customerVat: number, docType: number) {
  if (taxStatus === 'MONOTRIBUTO') return 11;
  return customerVat === 1 && docType === 80 ? 1 : 6;
}

/** Crea el pedido de factura de una venta (queda pendiente hasta que ARCA la autorice). */
export async function requestInvoice(
  db: Db,
  a: { storeId: string; saleId: string; docType: 80 | 96 | 99; docNumber: string; customerName?: string; customerVat: 1 | 5 | 6 },
) {
  const cfg = await db.fiscalConfig.findUnique({ where: { storeId: a.storeId } });
  if (!cfg || !cfg.enabled) throw new HttpError(409, 'fiscal_not_configured');
  const sale = await db.sale.findFirst({ where: { id: a.saleId, storeId: a.storeId } });
  if (!sale) throw new HttpError(404, 'sale_not_found');
  if (sale.status !== 'COMPLETED') throw new HttpError(409, 'sale_voided');
  const existing = await db.invoice.findUnique({ where: { saleId: sale.id } });
  if (existing) return existing;
  const doc = a.docType === 99 ? '0' : a.docNumber.replace(/\D/g, '');
  if (a.docType === 80 && doc.length !== 11) throw new HttpError(400, 'bad_cuit');
  if (a.docType === 96 && (doc.length < 7 || doc.length > 8)) throw new HttpError(400, 'bad_dni');
  const type = invoiceType(cfg.taxStatus, a.customerVat, a.docType);
  const total = num(sale.total);
  const rate = num(cfg.vatRate);
  const net = type === 11 ? total : round2(total / (1 + rate / 100));
  return db.invoice.create({
    data: {
      storeId: a.storeId,
      saleId: sale.id,
      publicToken: randomToken(12),
      type,
      pointOfSale: cfg.pointOfSale,
      docType: a.docType,
      docNumber: doc,
      customerName: a.customerName || null,
      customerVat: type === 11 && a.customerVat === 1 ? 1 : a.customerVat,
      total,
      net,
      vat: round2(total - net),
    },
  });
}

/** Pide el CAE a ARCA (una por vez por local). Si falla queda en ERROR con el motivo y se puede reintentar. */
export function authorizeInvoice(storeId: string, invoiceId: string) {
  return serialize(storeId, async () => {
    const inv = await prisma.invoice.findFirst({ where: { id: invoiceId, storeId } });
    if (!inv || inv.status === 'AUTHORIZED') return inv;
    const cfg = await prisma.fiscalConfig.findUnique({ where: { storeId } });
    if (!cfg || !cfg.enabled) return prisma.invoice.update({ where: { id: inv.id }, data: { status: 'ERROR', error: 'fiscal_not_configured' } });
    const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
    try {
      const auth = await access(cfg);
      // Reintento: si el número que se pidió antes quedó autorizado, se usa ese.
      if (inv.number) {
        const found = await lookup(cfg, auth, inv.pointOfSale, inv.type, inv.number);
        if (found && Math.abs(found.total - num(inv.total)) < 0.01 && found.docNumber === inv.docNumber) {
          return prisma.invoice.update({ where: { id: inv.id }, data: { status: 'AUTHORIZED', cae: found.cae, caeDue: ymdToDate(found.due), issuedAt: new Date(), error: null } });
        }
      }
      const number = (await lastNumber(cfg, auth, inv.pointOfSale, inv.type)) + 1;
      await prisma.invoice.update({ where: { id: inv.id }, data: { number } });
      const fch = localYMD(store.timezone).replace(/-/g, '');
      const money = (n: number) => round2(n).toFixed(2);
      const rateKey = String(num(cfg.vatRate));
      const iva =
        inv.type === 11
          ? ''
          : `<ar:Iva><ar:AlicIva><ar:Id>${VAT_ID[rateKey] ?? 5}</ar:Id><ar:BaseImp>${money(num(inv.net))}</ar:BaseImp><ar:Importe>${money(num(inv.vat))}</ar:Importe></ar:AlicIva></ar:Iva>`;
      const det =
        `<ar:FECAEDetRequest><ar:Concepto>1</ar:Concepto><ar:DocTipo>${inv.docType}</ar:DocTipo><ar:DocNro>${inv.docNumber}</ar:DocNro>` +
        `<ar:CbteDesde>${number}</ar:CbteDesde><ar:CbteHasta>${number}</ar:CbteHasta><ar:CbteFch>${fch}</ar:CbteFch>` +
        `<ar:ImpTotal>${money(num(inv.total))}</ar:ImpTotal><ar:ImpTotConc>0</ar:ImpTotConc><ar:ImpNeto>${money(num(inv.net))}</ar:ImpNeto>` +
        `<ar:ImpOpEx>0</ar:ImpOpEx><ar:ImpTrib>0</ar:ImpTrib><ar:ImpIVA>${money(num(inv.vat))}</ar:ImpIVA>` +
        `<ar:MonId>PES</ar:MonId><ar:MonCotiz>1</ar:MonCotiz><ar:CondicionIVAReceptorId>${inv.customerVat}</ar:CondicionIVAReceptorId>${iva}</ar:FECAEDetRequest>`;
      const xml = await wsfe(
        cfg,
        'FECAESolicitar',
        `${authXml(auth)}<ar:FeCAEReq><ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${inv.pointOfSale}</ar:PtoVta><ar:CbteTipo>${inv.type}</ar:CbteTipo></ar:FeCabReq><ar:FeDetReq>${det}</ar:FeDetReq></ar:FeCAEReq>`,
      );
      const { errs, obs } = wsfeErrors(xml);
      const cae = tag(xml, 'CAE');
      if (tag(xml, 'Resultado') !== 'A' || !cae) throw new ArcaError([...errs, ...obs].join(' · ') || 'ARCA rechazó la factura');
      return prisma.invoice.update({
        where: { id: inv.id },
        data: { status: 'AUTHORIZED', cae, caeDue: ymdToDate(tag(xml, 'CAEFchVto') ?? fch), issuedAt: new Date(), error: obs.length ? obs.join(' · ') : null },
      });
    } catch (e) {
      return prisma.invoice.update({ where: { id: inv.id }, data: { status: 'ERROR', error: (e as Error).message.slice(0, 500) } });
    }
  });
}

/** Link del QR de ARCA que va impreso en la factura (RG 4892). */
export function arcaQrUrl(a: { date: string; cuit: string; pointOfSale: number; type: number; number: number; total: number; docType: number; docNumber: string; cae: string }) {
  const data = {
    ver: 1,
    fecha: a.date,
    cuit: Number(a.cuit),
    ptoVta: a.pointOfSale,
    tipoCmp: a.type,
    nroCmp: a.number,
    importe: a.total,
    moneda: 'PES',
    ctz: 1,
    tipoDocRec: a.docType,
    nroDocRec: Number(a.docNumber),
    tipoCodAut: 'E',
    codAut: Number(a.cae),
  };
  return `https://www.afip.gob.ar/fe/qr/?p=${Buffer.from(JSON.stringify(data)).toString('base64')}`;
}

/** Prueba de conexión: pide acceso y el último número de cada tipo que usa el local. */
export async function testConnection(storeId: string) {
  const cfg = await prisma.fiscalConfig.findUnique({ where: { storeId } });
  if (!cfg) throw new HttpError(409, 'fiscal_not_configured');
  try {
    const auth = await access(cfg);
    const types = cfg.taxStatus === 'MONOTRIBUTO' ? [11] : [6, 1];
    const last: Record<string, number> = {};
    for (const t of types) last[INVOICE_LETTER[t]] = await lastNumber(cfg, auth, cfg.pointOfSale, t);
    return { ok: true, last };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
