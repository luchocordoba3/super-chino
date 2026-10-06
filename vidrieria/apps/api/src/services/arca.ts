import forge from 'node-forge';
import type { Business } from '@prisma/client';
import { HttpError } from '../lib/http';
import { open } from '../lib/secret';

/**
 * Factura electrónica de ARCA (ex AFIP), directo y sin proveedor pago:
 * WSAA para autenticarse (pedido firmado con el certificado de la vidriería) y WSFEv1 para emitir la factura C.
 */
const URLS = {
  homo: { wsaa: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms', wsfe: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx' },
  prod: { wsaa: 'https://wsaa.afip.gov.ar/ws/services/LoginCms', wsfe: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx' },
};
export const FACTURA_C = 11;
/** Condición frente al IVA del que recibe la factura (obligatoria desde 2025). */
export const CONDICION_IVA = { CONSUMIDOR_FINAL: 5, RESPONSABLE_INSCRIPTO: 1, MONOTRIBUTO: 6, EXENTO: 4 } as const;

const tag = (xml: string, name: string) => xml.match(new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)</(?:\\w+:)?${name}>`))?.[1]?.trim() ?? null;
const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');

/** Pedido de acceso (TRA) firmado como CMS, en base64. */
export function signTra(certPem: string, keyPem: string, service = 'wsfe', now = new Date()) {
  const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const tra = `<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header><uniqueId>${Math.floor(now.getTime() / 1000)}</uniqueId><generationTime>${iso(new Date(now.getTime() - 10 * 60_000))}</generationTime><expirationTime>${iso(new Date(now.getTime() + 10 * 60_000))}</expirationTime></header><service>${service}</service></loginTicketRequest>`;
  const cert = forge.pki.certificateFromPem(certPem);
  const key = forge.pki.privateKeyFromPem(keyPem);
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, 'utf8');
  p7.addCertificate(cert);
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: now.toISOString() },
    ],
  });
  p7.sign();
  return forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());
}

async function soap(url: string, action: string, body: string) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'text/xml; charset=utf-8', SOAPAction: action },
    body,
  });
  const text = await res.text();
  if (!res.ok && !text.includes('Envelope')) throw new HttpError(502, 'arca_error', `ARCA no respondió (${res.status})`);
  const fault = tag(text, 'faultstring');
  if (fault) throw new HttpError(502, 'arca_error', `ARCA: ${fault}`);
  return text;
}

/** Token y firma de ARCA: duran 12 horas, se guardan en memoria por vidriería. */
const tickets = new Map<string, { token: string; sign: string; until: number }>();

export function arcaConfig(b: Business) {
  const cert = open(b.arcaCert);
  const key = open(b.arcaKey);
  const cuit = b.arcaCuit.replace(/\D/g, '');
  if (!cert || !key || cuit.length !== 11) return null;
  return { cert, key, cuit, ptoVta: b.arcaPtoVta, urls: b.arcaProduction ? URLS.prod : URLS.homo };
}

async function ticket(b: Business) {
  const cfg = arcaConfig(b);
  if (!cfg) throw new HttpError(409, 'arca_not_ready', 'Falta cargar el CUIT, el certificado y la clave de ARCA en Ajustes');
  const cached = tickets.get(b.id);
  if (cached && cached.until > Date.now() + 60_000) return { ...cached, cfg };
  const cms = signTra(cfg.cert, cfg.key);
  const xml = await soap(
    cfg.urls.wsaa,
    '',
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov"><soapenv:Header/><soapenv:Body><wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>`,
  );
  const ret = unescape(tag(xml, 'loginCmsReturn') ?? '');
  const token = tag(ret, 'token');
  const sign = tag(ret, 'sign');
  const exp = tag(ret, 'expirationTime');
  if (!token || !sign) throw new HttpError(502, 'arca_error', 'ARCA no devolvió el acceso');
  const t = { token, sign, until: exp ? new Date(exp).getTime() : Date.now() + 11 * 3_600_000 };
  tickets.set(b.id, t);
  return { ...t, cfg };
}

const auth = (t: { token: string; sign: string }, cuit: string) => `<ar:Auth><ar:Token>${t.token}</ar:Token><ar:Sign>${t.sign}</ar:Sign><ar:Cuit>${cuit}</ar:Cuit></ar:Auth>`;
const env = (inner: string) => `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/"><soap:Body>${inner}</soap:Body></soap:Envelope>`;

export interface InvoiceRequest {
  amount: number;
  date?: Date;
  /** 1 productos, 2 servicios, 3 productos y servicios. */
  concepto: 1 | 2 | 3;
  docTipo: 99 | 80 | 96;
  docNro: string;
  condicionIva: number;
}

/** Emite una factura C y devuelve número y CAE. */
export async function emitFacturaC(b: Business, r: InvoiceRequest) {
  const t = await ticket(b);
  const { cuit, ptoVta, urls } = t.cfg;
  const last = await soap(
    urls.wsfe,
    'http://ar.gov.afip.dif.FEV1/FECompUltimoAutorizado',
    env(`<ar:FECompUltimoAutorizado>${auth(t, cuit)}<ar:PtoVta>${ptoVta}</ar:PtoVta><ar:CbteTipo>${FACTURA_C}</ar:CbteTipo></ar:FECompUltimoAutorizado>`),
  );
  const number = Number(tag(last, 'CbteNro') ?? 0) + 1;
  const date = r.date ?? new Date();
  const total = (Math.round(r.amount * 100) / 100).toFixed(2);
  const services = r.concepto !== 1 ? `<ar:FchServDesde>${ymd(date)}</ar:FchServDesde><ar:FchServHasta>${ymd(date)}</ar:FchServHasta><ar:FchVtoPago>${ymd(date)}</ar:FchVtoPago>` : '';
  const res = await soap(
    urls.wsfe,
    'http://ar.gov.afip.dif.FEV1/FECAESolicitar',
    env(
      `<ar:FECAESolicitar>${auth(t, cuit)}<ar:FeCAEReq><ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${ptoVta}</ar:PtoVta><ar:CbteTipo>${FACTURA_C}</ar:CbteTipo></ar:FeCabReq><ar:FeDetReq><ar:FECAEDetRequest><ar:Concepto>${r.concepto}</ar:Concepto><ar:DocTipo>${r.docTipo}</ar:DocTipo><ar:DocNro>${r.docNro.replace(/\D/g, '') || '0'}</ar:DocNro><ar:CbteDesde>${number}</ar:CbteDesde><ar:CbteHasta>${number}</ar:CbteHasta><ar:CbteFch>${ymd(date)}</ar:CbteFch><ar:ImpTotal>${total}</ar:ImpTotal><ar:ImpTotConc>0</ar:ImpTotConc><ar:ImpNeto>${total}</ar:ImpNeto><ar:ImpOpEx>0</ar:ImpOpEx><ar:ImpTrib>0</ar:ImpTrib><ar:ImpIVA>0</ar:ImpIVA>${services}<ar:MonId>PES</ar:MonId><ar:MonCotiz>1</ar:MonCotiz><ar:CondicionIVAReceptorId>${r.condicionIva}</ar:CondicionIVAReceptorId></ar:FECAEDetRequest></ar:FeDetReq></ar:FeCAEReq></ar:FECAESolicitar>`,
    ),
  );
  const result = tag(res, 'Resultado');
  const cae = tag(res, 'CAE');
  if (result !== 'A' || !cae) {
    const msg = tag(res, 'Msg') ?? 'ARCA rechazó la factura';
    throw new HttpError(422, 'arca_rejected', `ARCA rechazó la factura: ${unescape(msg)}`);
  }
  const due = tag(res, 'CAEFchVto');
  return { ptoVta, number, cae, caeDue: due ? new Date(`${due.slice(0, 4)}-${due.slice(4, 6)}-${due.slice(6, 8)}T12:00:00Z`) : null, date };
}

/** Para los tests: vaciar el acceso guardado. */
export const resetArcaTickets = () => tickets.clear();
