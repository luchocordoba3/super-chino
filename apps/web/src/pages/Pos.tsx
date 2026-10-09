import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BASIC_PAYMENT_METHODS, CASH_MOVE_KINDS, type CashMoveKind, cashMoveSign, type Payment, type PaymentMethod, type PosEvent, round2 } from '@super-chino/shared';
import { api } from '../api';
import { beep } from '../components/BarcodeScanner';
import { Field, Modal, toast, toNum } from '../components/ui';
import { setLang } from '../i18n';
import { money, qtyFmt, setCurrency, timeFmt } from '../lib/format';
import type { Me } from '../lib/me';
import { addItem, type CartItem, cartTotal, type OfferInfo, parseScan, priceCart, settlePayments } from '../pos/cart';
import { type CashMoveLocal, type CashSessionLocal, type CatalogProduct, db, kvDel, kvGet, kvSet, type LocalSale, normalize, type PosUser, type StoreInfo, type SupplierRow } from '../pos/db';
import { verifyPin } from '../pos/pin';
import { CourierModal, CustomerModal, DepositModal, findSerial, loadPhone, PayTradeInModal, type PhonePayResult, PhonePayModal, PhoneTicket, RepairChargeModal, type SaleCustomer, type Serial, serialDetail, UnitPicker, warrantyUntilFor } from '../celu/PosPhone';
import { round2 as r2, usd } from '../celu/common';
import type { PhoneData } from '../pos/db';
import { enqueue, flushOutbox, getDeviceToken, linkDevice, pendingCount, refreshCatalog, syncEvents, UnlinkedError, unsyncedOfferQty } from '../pos/sync';

type Phase = 'loading' | 'unlinked' | 'pick' | 'open' | 'sell';
const uuid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

/** La caja: funciona con o sin internet. Todo se guarda en la PC y se sincroniza solo. */
export function Pos() {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>('loading');
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [cashier, setCashier] = useState<PosUser | null>(null);
  const [session, setSession] = useState<CashSessionLocal | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(0);
  const [clocking, setClocking] = useState(false);
  const [phones, setPhones] = useState(false);

  const loadLocal = useCallback(async () => {
    setPhones(!!(await kvGet<PhoneData | null>('phones')));
    const s = await kvGet<StoreInfo>('store');
    if (s) {
      setStore(s);
      setCurrency(s.currency);
    }
    setSession((await kvGet<CashSessionLocal>('cashSession')) ?? null);
  }, []);

  const start = useCallback(async () => {
    if (!(await getDeviceToken())) return setPhase('unlinked');
    await loadLocal();
    setPhase('pick');
    try {
      await refreshCatalog();
      await loadLocal();
      setOnline(true);
    } catch (e) {
      if (e instanceof UnlinkedError) setPhase('unlinked');
      else setOnline(false);
    }
  }, [loadLocal]);

  useEffect(() => {
    void start();
  }, [start]);

  // Sincronización en segundo plano.
  useEffect(() => {
    const update = () => void pendingCount().then(setPending);
    const onFail = (e: unknown) => {
      if (e instanceof UnlinkedError) {
        toast(t('pos.unlinked'));
        setPhase('unlinked');
      } else setOnline(false);
    };
    const sync = () =>
      flushOutbox()
        .then(() => refreshCatalog())
        .then(() => setOnline(true))
        .catch(onFail);
    const offline = () => setOnline(false);
    syncEvents.addEventListener('change', update);
    window.addEventListener('online', sync);
    window.addEventListener('offline', offline);
    const id = setInterval(sync, 20_000);
    update();
    return () => {
      syncEvents.removeEventListener('change', update);
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', offline);
      clearInterval(id);
    };
  }, [t]);

  const pickCashier = (u: PosUser) => {
    setCashier(u);
    setLang(u.lang);
    setPhase(session ? 'sell' : 'open');
  };

  if (phase === 'loading') return <div className="center-box">{t('common.loading')}</div>;
  if (phase === 'unlinked') return <LinkScreen onLinked={() => void start()} />;

  const status = (
    <span className={`pos-status ${online ? '' : 'off'}`}>
      {online ? '●' : t('common.offline')} · {pending ? t('pos.pendingSync', { count: pending }) : t('pos.synced')}
    </span>
  );

  if (phase === 'pick' || !cashier) {
    return (
      <div className="center-box stack">
        <div className="row between">
          <h1>
            {phones ? '📱' : '🛒'} {store?.name}
          </h1>
          {status}
        </div>
        <PickUser title={t('pos.whoSells')} only={(u) => u.role === 'OWNER' || u.canSell !== false} onPicked={pickCashier} />
        <button className="big" onClick={() => setClocking(true)}>
          🕘 {t('pos.clockInOut')}
        </button>
        {clocking && <ClockModal onClose={() => setClocking(false)} />}
        <a href="/">← {t('nav.home')}</a>
      </div>
    );
  }
  if (phase === 'open' || !session) {
    return (
      <OpenCash
        phones={phones}
        cashier={cashier}
        onOpened={(s) => {
          setSession(s);
          setPhase('sell');
        }}
        onBack={() => setPhase('pick')}
      />
    );
  }
  return (
    <SellScreen
      phones={phones}
      store={store}
      cashier={cashier}
      session={session}
      status={status}
      onSwitch={() => {
        setCashier(null);
        setPhase('pick');
      }}
      onClosed={() => {
        setSession(null);
        setCashier(null);
        setPhase('pick');
      }}
    />
  );
}

function LinkScreen({ onLinked }: { onLinked: () => void }) {
  const { t } = useTranslation();
  const [owner, setOwner] = useState<boolean | null>(null);
  const [name, setName] = useState('Caja 1');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Me>('/auth/me')
      .then((m) => setOwner(m.user.role === 'OWNER'))
      .catch(() => setOwner(false));
  }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await linkDevice(name);
      onLinked();
    } catch (err) {
      toast(String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="center-box card stack">
      <h1>{t('pos.title')}</h1>
      <p>{t('pos.notLinked')}</p>
      {owner === false && (
        <>
          <p className="muted">{t('pos.needOwner')}</p>
          <a className="btn" href="/">
            {t('login.enter')}
          </a>
        </>
      )}
      {owner && (
        <form className="stack" onSubmit={submit}>
          <Field label={t('pos.deviceName')}>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <button className="primary big" disabled={busy}>
            {t('pos.linkThisPc')}
          </button>
        </form>
      )}
    </div>
  );
}

/** Elegir a una persona y pedirle el PIN (se verifica en la PC, sin internet). */
function PickUser({ title, only, onPicked }: { title: string; only: (u: PosUser) => boolean; onPicked: (u: PosUser) => void }) {
  const { t } = useTranslation();
  const [users, setUsers] = useState<PosUser[]>([]);
  const [sel, setSel] = useState<PosUser | null>(null);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    const load = () => void db.users.toArray().then((u) => setUsers(u.sort((a, b) => a.name.localeCompare(b.name))));
    load();
    syncEvents.addEventListener('change', load);
    return () => syncEvents.removeEventListener('change', load);
  }, []);
  const tryPin = async (p: string) => {
    if (sel && (await verifyPin(p, sel.pin))) onPicked(sel);
    else {
      setErr(t('pos.wrongPin'));
      setPin('');
    }
  };
  if (!sel) {
    return (
      <div className="card stack">
        <h2>{title}</h2>
        <div className="user-tiles">
          {users.filter(only).map((u) => (
            <button key={u.id} onClick={() => setSel(u)}>
              {u.name}
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <form
      className="card stack"
      onSubmit={(e) => {
        e.preventDefault();
        void tryPin(pin);
      }}
    >
      <h2>
        {sel.name} · {t('pos.enterPin')}
      </h2>
      <input type="password" inputMode="numeric" autoFocus value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} style={{ fontSize: '1.6rem', textAlign: 'center' }} />
      {err && <p className="error">{err}</p>}
      <div className="pinpad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '←', '0', '✓'].map((k) => (
          <button
            type={k === '✓' ? 'submit' : 'button'}
            key={k}
            className={k === '✓' ? 'primary' : ''}
            onClick={() => (k === '←' ? setPin(pin.slice(0, -1)) : k !== '✓' && setPin(pin + k))}
          >
            {k}
          </button>
        ))}
      </div>
      <button type="button" className="ghost" onClick={() => (setSel(null), setPin(''), setErr(''))}>
        ← {t('common.back')}
      </button>
    </form>
  );
}

/** Fichar entrada o salida en la caja: se elige la persona, pone su PIN y listo (anda sin internet). */
function ClockModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [who, setWho] = useState<PosUser | null>(null);
  const [last, setLast] = useState<Record<string, 'in' | 'out'>>({});
  useEffect(() => {
    void kvGet<Record<string, 'in' | 'out'>>('clockLast').then((v) => setLast(v ?? {}));
  }, []);
  const clock = async (action: 'in' | 'out') => {
    if (!who) return;
    const occurredAt = nowIso();
    await enqueue({ id: uuid(), type: 'CLOCK', userId: who.id, occurredAt, action });
    await kvSet('clockLast', { ...last, [who.id]: action });
    toast(t(action === 'in' ? 'pos.clockedIn' : 'pos.clockedOut', { name: who.name, time: timeFmt(occurredAt) }));
    onClose();
  };
  // Se sugiere lo que corresponde según el último fichaje hecho en esta PC.
  const next = who && last[who.id] === 'in' ? 'out' : 'in';
  return (
    <Modal title={`🕘 ${t('pos.clockInOut')}`} onClose={onClose}>
      {!who ? (
        <PickUser title={t('pos.clockWho')} only={(u) => u.role !== 'OWNER'} onPicked={setWho} />
      ) : (
        <div className="stack">
          <h2>{who.name}</h2>
          <button className={`big ${next === 'in' ? 'primary' : ''}`} onClick={() => void clock('in')}>
            ▶ {t('pos.clockIn')}
          </button>
          <button className={`big ${next === 'out' ? 'primary' : ''}`} onClick={() => void clock('out')}>
            ⏹ {t('pos.clockOut')}
          </button>
        </div>
      )}
    </Modal>
  );
}

/** Pago a proveedor, gasto, retiro o ingreso de cambio: queda anotado para que el cierre dé bien. */
function CashMoveModal({ session, cashier, onClose, phones }: { session: CashSessionLocal; cashier: PosUser; onClose: () => void; phones?: boolean }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<CashMoveKind>('SUPPLIER');
  const [currency, setCurrency] = useState<'ARS' | 'USD'>('ARS');
  const [amount, setAmount] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [reason, setReason] = useState('');
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  useEffect(() => {
    void kvGet<SupplierRow[]>('suppliers').then((s) => setSuppliers(s ?? []));
  }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = toNum(amount);
    if (!n || n <= 0) return;
    const id = uuid();
    const occurredAt = nowIso();
    const supplier = kind === 'SUPPLIER' ? suppliers.find((s) => s.id === supplierId) : undefined;
    const why = reason.trim() || undefined;
    await enqueue({ id, type: 'CASH_MOVE', userId: cashier.id, occurredAt, cashSessionId: session.id, kind, amount: n, reason: why, supplierId: supplier?.id ?? null, ...(phones ? { currency } : {}) });
    const key = `cashMoves:${session.id}`;
    await kvSet(key, [...((await kvGet<CashMoveLocal[]>(key)) ?? []), { id, kind, amount: n, currency, reason: why, supplierName: supplier?.name, occurredAt }]);
    toast(t('pos.moveSaved', { amount: currency === 'USD' ? usd(n) : money(n) }));
    onClose();
  };
  return (
    <Modal title={`💸 ${t('pos.cashMove')}`} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <div className="grid2">
          {CASH_MOVE_KINDS.map((k) => (
            <label key={k} className="check">
              <input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} /> {t(`pos.moveKinds.${k}`)}
            </label>
          ))}
        </div>
        {phones && (
          <div className="row">
            <button type="button" className={`small ${currency === 'ARS' ? 'primary' : ''}`} onClick={() => setCurrency('ARS')}>
              Pesos
            </button>
            <button type="button" className={`small ${currency === 'USD' ? 'primary' : ''}`} onClick={() => setCurrency('USD')}>
              Dólares
            </button>
          </div>
        )}
        <Field label={t('pos.amount')}>
          <input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ fontSize: '1.4rem' }} required />
        </Field>
        {kind === 'SUPPLIER' && suppliers.length > 0 && (
          <Field label={t('products.supplier')}>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">—</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={t('common.reason')}>
          <input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <button className="primary big">{t('common.save')}</button>
      </form>
    </Modal>
  );
}

function OpenCash({ cashier, onOpened, onBack, phones }: { cashier: PosUser; onOpened: (s: CashSessionLocal) => void; onBack: () => void; phones?: boolean }) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');
  const [amountUsd, setAmountUsd] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const s: CashSessionLocal = { id: uuid(), userId: cashier.id, openedAt: nowIso(), openingAmount: toNum(amount) ?? 0, ...(phones ? { openingUsd: toNum(amountUsd) ?? 0 } : {}) };
    await kvSet('cashSession', s);
    await enqueue({ id: uuid(), type: 'CASH_OPEN', userId: cashier.id, occurredAt: s.openedAt, cashSessionId: s.id, openingAmount: s.openingAmount, ...(phones ? { openingUsd: s.openingUsd } : {}) });
    onOpened(s);
  };
  return (
    <form className="center-box card stack" onSubmit={submit}>
      <h1>{t('pos.openCash')}</h1>
      <p>{cashier.name}</p>
      <Field label={t('pos.openingAmount')}>
        <input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ fontSize: '1.4rem' }} />
      </Field>
      {phones && (
        <Field label="Dólares en la caja">
          <input inputMode="decimal" value={amountUsd} onChange={(e) => setAmountUsd(e.target.value)} style={{ fontSize: '1.4rem' }} />
        </Field>
      )}
      <button className="primary big">{t('pos.openCash')}</button>
      <button type="button" className="ghost" onClick={onBack}>
        ← {t('common.back')}
      </button>
    </form>
  );
}

function SellScreen(props: {
  phones: boolean;
  store: StoreInfo | null;
  cashier: PosUser;
  session: CashSessionLocal;
  status: React.ReactNode;
  onSwitch: () => void;
  onClosed: () => void;
}) {
  const { store, cashier, session } = props;
  const { t } = useTranslation();
  const cartKey = `pos.cart.${session.id}`;
  const [items, setItems] = useState<CartItem[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(cartKey) ?? '[]') as CartItem[];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      if (items.length) localStorage.setItem(cartKey, JSON.stringify(items));
      else localStorage.removeItem(cartKey);
    } catch {
      // sin localStorage: el carrito queda solo en memoria
    }
  }, [items, cartKey]);
  const [offers, setOffers] = useState<Map<string, OfferInfo>>(new Map());
  const [input, setInput] = useState('');
  const [results, setResults] = useState<{ list: CatalogProduct[]; qty: number | null } | null>(null);
  const [weightFor, setWeightFor] = useState<CatalogProduct | null>(null);
  const [paying, setPaying] = useState(false);
  const [done, setDone] = useState<LocalSale | null>(null);
  const [closing, setClosing] = useState(false);
  const [clocking, setClocking] = useState(false);
  const [moving, setMoving] = useState(false);
  const [recent, setRecent] = useState<LocalSale[]>([]);
  const [printing, setPrinting] = useState<LocalSale | null>(null);
  const [catalogCount, setCatalogCount] = useState(0);
  // Casa de celulares
  const [ph, setPh] = useState<PhoneData | null>(null);
  const [customer, setCustomer] = useState<SaleCustomer | null>(null);
  const [phModal, setPhModal] = useState<'customer' | 'deposit' | 'repair' | 'tradein' | 'courier' | null>(null);
  const [unitFor, setUnitFor] = useState<string | null>(null);
  const rate = ph?.rate ?? null;
  const inputRef = useRef<HTMLInputElement>(null);
  const canOverride = cashier.role === 'OWNER' || cashier.perms.includes('prices');
  const focus = () => setTimeout(() => inputRef.current?.focus(), 0);

  const loadSide = useCallback(async () => {
    const [rows, used] = await Promise.all([db.offers.toArray(), unsyncedOfferQty()]);
    setOffers(new Map(rows.map((o) => [o.productId, { id: o.id, offerPrice: o.offerPrice, remaining: Math.max(0, o.maxQty - (used.get(o.id) ?? 0)) }])));
    setRecent(await db.sales.where('cashSessionId').equals(session.id).reverse().sortBy('occurredAt'));
    setCatalogCount(await db.products.count());
    if (props.phones) setPh(await loadPhone());
  }, [session.id, props.phones]);

  useEffect(() => {
    void loadSide();
    syncEvents.addEventListener('change', loadSide);
    return () => syncEvents.removeEventListener('change', loadSide);
  }, [loadSide]);

  const lines = useMemo(() => priceCart(items, offers), [items, offers]);
  const total = cartTotal(lines);

  const add = (p: CatalogProduct, qty: number) => {
    if (ph && p.serialized) {
      // Celular: hay que elegir cuál (IMEI).
      setResults(null);
      return setUnitFor(p.id);
    }
    if (ph && p.currency === 'USD' && !rate) return toast('Falta la cotización del dólar (Ajustes)');
    const price = ph && p.currency === 'USD' ? r2(p.price * rate!) : p.price;
    setItems((prev) => addItem(prev, { ...p, price }, qty));
    setResults(null);
    beep();
    focus();
  };

  const addSerial = (s: Serial) => {
    setUnitFor(null);
    if (items.some((x) => x.serialItemId === s.id)) return toast('Ese equipo ya está en la venta');
    if (s.currency === 'USD' && !rate) return toast('Falta la cotización del dólar (Ajustes)');
    if (s.status === 'RESERVED') toast('Equipo señado: al cobrar usá la seña como pago');
    const price = s.currency === 'USD' ? r2(s.price * rate!) : s.price;
    setItems((prev) => [...prev, { productId: s.productId, name: s.name, unit: 'UNIT', qty: 1, listPrice: price, serialItemId: s.id, detail: serialDetail(s) }]);
    if (!customer && s.customerId && ph) {
      const c = ph.customers.find((x) => x.id === s.customerId);
      if (c) setCustomer(c);
    }
    setResults(null);
    beep();
    focus();
  };

  const onScan = async (raw: string) => {
    const { qty, code } = parseScan(raw);
    setInput('');
    if (!code) return;
    const unit = ph ? findSerial(ph, code) : undefined;
    if (unit) return addSerial(unit);
    const p = await db.products.where('barcode').equals(code).first();
    if (p?.active) {
      if (p.unit === 'KG' && qty == null) return setWeightFor(p);
      return add(p, qty ?? 1);
    }
    const term = normalize(code);
    const list = await db.products.filter((x) => x.active && x.search.includes(term)).limit(12).toArray();
    if (list.length === 0) {
      toast(t('pos.notFoundCode', { code }));
      return focus();
    }
    setResults({ list, qty });
  };

  const removeLine = (productId: string, overridden: boolean, lineId?: string | null) => {
    const it = lineId ? items.find((x) => x.serialItemId === lineId || x.repairOrderId === lineId) : items.find((x) => x.productId === productId && (x.overridePrice != null) === overridden && !x.serialItemId && !x.repairOrderId);
    if (!it) return;
    setItems((prev) => prev.filter((x) => x !== it));
    void enqueue({ id: uuid(), type: 'ITEM_REMOVED', userId: cashier.id, occurredAt: nowIso(), cashSessionId: session.id, productId, qty: it.qty, amount: round2(it.qty * (it.overridePrice ?? it.listPrice)) });
    focus();
  };

  const changeQty = (productId: string, delta: number) =>
    setItems((prev) => prev.map((x) => (x.productId === productId && x.overridePrice == null ? { ...x, qty: Math.max(1, x.qty + delta) } : x)));

  const override = (productId: string, lineId?: string | null) => {
    const v = toNum(window.prompt(t('pos.overridePrice')) ?? '');
    if (v == null || v < 0) return;
    setItems((prev) => prev.map((x) => ((lineId ? x.serialItemId === lineId || x.repairOrderId === lineId : x.productId === productId && !x.serialItemId) ? { ...x, overridePrice: v } : x)));
    focus();
  };

  const clearCart = () => {
    if (items.length === 0) return;
    for (const it of items) {
      void enqueue({ id: uuid(), type: 'ITEM_REMOVED', userId: cashier.id, occurredAt: nowIso(), cashSessionId: session.id, productId: it.productId, qty: it.qty, amount: round2(it.qty * (it.overridePrice ?? it.listPrice)) });
    }
    setItems([]);
    focus();
  };

  const confirmSale = async (payments: Payment[], change: number, phone?: PhonePayResult) => {
    const id = uuid();
    const occurredAt = nowIso();
    const event: PosEvent = {
      id,
      type: 'SALE',
      userId: cashier.id,
      occurredAt,
      cashSessionId: session.id,
      items: lines.map((l) => ({
        productId: l.productId,
        qty: l.qty,
        unitPrice: l.unitPrice,
        listPrice: l.listPrice,
        offerId: l.offerId,
        priceOverride: l.priceOverride,
        ...(l.serialItemId ? { serialItemId: l.serialItemId } : {}),
        ...(l.repairOrderId ? { repairOrderId: l.repairOrderId } : {}),
      })),
      payments,
      total,
      ...(phone
        ? {
            rate: rate ?? undefined,
            cashArs: phone.cashArs,
            cashUsd: phone.cashUsd,
            customerId: customer && !customer.isNew ? customer.id : null,
            newCustomer: customer?.isNew ? { id: customer.id, name: customer.name, phone: customer.phone ?? undefined, dni: customer.dni ?? undefined } : undefined,
          }
        : {}),
    };
    // Garantía de cada renglón para el certificado (casa de celulares).
    const products = ph ? new Map((await db.products.bulkGet([...new Set(lines.map((l) => l.productId))])).filter(Boolean).map((p) => [p!.id, p!])) : new Map<string, CatalogProduct>();
    const warrantyOf = (l: (typeof lines)[number]) => {
      if (!ph || !store) return null;
      if (l.repairOrderId) {
        const d = new Date(Date.now() + store.settings.repairWarrantyDays * 86_400_000);
        return store.settings.repairWarrantyDays > 0 ? d.toISOString().slice(0, 10) : null;
      }
      const p = products.get(l.productId);
      if (!p || p.isService) return null;
      const s = l.serialItemId ? ph.serials.find((x) => x.id === l.serialItemId) : null;
      return warrantyUntilFor(store.settings, s?.condition ?? 'NEW', p.warrantyMonths);
    };
    const local: LocalSale = {
      id,
      occurredAt,
      userId: cashier.id,
      cashSessionId: session.id,
      lines: lines.map((l) => {
        const s = l.serialItemId ? ph?.serials.find((x) => x.id === l.serialItemId) : null;
        return {
          name: l.name,
          qty: l.qty,
          unitPrice: l.unitPrice,
          lineTotal: l.lineTotal,
          offer: !!l.offerId,
          ...(ph ? { imei: s ? (s.imei1 ? `IMEI ${s.imei1}` : s.serial) : null, condition: s ? (s.condition === 'NEW' ? 'Nuevo' : `Usado${s.grade ? ` ${s.grade}` : ''}`) : null, warrantyUntil: warrantyOf(l) } : {}),
        };
      }),
      total,
      payments,
      change,
      ...(phone ? { cashArs: phone.cashArs, cashUsd: phone.cashUsd, changeUsd: phone.changeUsd, rate, customerName: customer?.name ?? null } : {}),
    };
    await db.sales.put(local);
    await enqueue(event);
    const old = await db.sales.orderBy('occurredAt').reverse().offset(300).primaryKeys();
    if (old.length) await db.sales.bulkDelete(old);
    setItems([]);
    setPaying(false);
    setCustomer(null);
    setDone(local);
    void loadSide();
  };

  const voidSale = async (s: LocalSale) => {
    const reason = window.prompt(t('pos.voidReason'));
    if (reason === null) return;
    await enqueue({ id: uuid(), type: 'SALE_VOIDED', userId: cashier.id, occurredAt: nowIso(), cashSessionId: session.id, saleId: s.id, reason });
    await db.sales.update(s.id, { voided: true });
    void loadSide();
  };

  const print = (s: LocalSale) => {
    setPrinting(s);
    setTimeout(() => window.print(), 50);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (paying || done || closing || weightFor || clocking || moving || phModal || unitFor) return;
      if (e.key === 'F2') {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === 'F12' && items.length) {
        e.preventDefault();
        setPaying(true);
      } else if (e.key === 'Escape') {
        if (results) setResults(null);
        else clearCart();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="pos">
      <div className="pos-left">
        <div className="pos-top no-print">
          <strong className="grow">
            {ph ? '📱' : '🛒'} {store?.name}
          </strong>
          {ph && <span className="small">{rate ? `US$ 1 = ${money(rate)}` : 'Sin dólar'}</span>}
          <span>{cashier.name}</span>
          {props.status}
          <button onClick={() => setClocking(true)}>🕘 {t('pos.clock')}</button>
          <button onClick={() => setMoving(true)}>💸 {t('pos.cashMove')}</button>
          {ph && (
            <>
              <button onClick={() => setPhModal('repair')}>🔧 Reparación</button>
              <button onClick={() => setPhModal('deposit')}>💵 Seña</button>
              <button onClick={() => setPhModal('tradein')}>♻️ Pagar usado</button>
              <button onClick={() => setPhModal('courier')}>🛵 Cadete</button>
            </>
          )}
          <button onClick={props.onSwitch}>{t('pos.changeCashier')}</button>
          <button onClick={() => setClosing(true)}>{t('pos.closeCash')}</button>
        </div>
        <form
          className="pos-scan no-print"
          onSubmit={(e) => {
            e.preventDefault();
            void onScan(input);
          }}
        >
          <input ref={inputRef} autoFocus value={input} onChange={(e) => setInput(e.target.value)} placeholder={t('pos.scanHere')} />
          <div className="hint">
            {t('pos.keyboardHelp')} · {t('pos.catalogInfo', { count: catalogCount })}
          </div>
        </form>
        {results && (
          <div className="pos-cart" style={{ flex: 'none', maxHeight: '40vh' }}>
            {results.list.map((p) => (
              <button key={p.id} className="pos-line" style={{ width: '100%', textAlign: 'left' }} onClick={() => (p.unit === 'KG' && results.qty == null ? setWeightFor(p) : add(p, results.qty ?? 1))}>
                <span className="n">{p.name}</span>
                <span className="muted small">{p.serialized && ph ? `${ph.serials.filter((s) => s.productId === p.id).length} disponibles` : p.barcode}</span>
                <span />
                <strong>{p.currency === 'USD' ? usd(p.price) : money(p.price)}</strong>
              </button>
            ))}
          </div>
        )}
        <div className="pos-cart">
          {lines.length === 0 && <p className="muted">{t('pos.emptyCart')}</p>}
          {lines.map((l) => (
            <div className="pos-line" key={l.key}>
              <div>
                <div className="n">{l.name}</div>
                {l.detail && <div className="small muted">{l.detail}</div>}
                <div className="small muted">
                  {qtyFmt(l.qty)} {l.unit === 'KG' ? 'kg' : ''} × {money(l.unitPrice)}
                  {l.offerId && <span className="badge red"> {t('pos.offer')}</span>}
                  {l.priceOverride && <span className="badge gold"> {t('pos.overridePrice')}</span>}
                </div>
              </div>
              {l.unit === 'UNIT' && !l.priceOverride && !l.serialItemId && !l.repairOrderId ? (
                <div className="row">
                  <button className="small" onClick={() => changeQty(l.productId, -1)}>
                    −
                  </button>
                  <button className="small" onClick={() => changeQty(l.productId, 1)}>
                    +
                  </button>
                </div>
              ) : (
                <span />
              )}
              <strong>{money(l.lineTotal)}</strong>
              <div className="row">
                {canOverride && !l.priceOverride && (
                  <button className="small ghost" title={t('pos.overridePrice')} onClick={() => override(l.productId, l.serialItemId ?? l.repairOrderId)}>
                    $
                  </button>
                )}
                <button className="small ghost" onClick={() => removeLine(l.productId, l.priceOverride, l.serialItemId ?? l.repairOrderId)}>
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="pos-right no-print">
        {ph && (
          <button onClick={() => setPhModal('customer')} style={{ justifyContent: 'flex-start' }}>
            👤 {customer ? customer.name : 'Agregar cliente'}
          </button>
        )}
        <div className="pos-total">{money(total)}</div>
        {ph && rate ? <div className="right muted">{usd(r2(total / rate))}</div> : null}
        <button className="primary big" disabled={!items.length} onClick={() => setPaying(true)}>
          {t('pos.pay')} (F12)
        </button>
        <button disabled={!items.length} onClick={clearCart}>
          {t('pos.clearCart')}
        </button>
        <h3>{t('pos.lastSales')}</h3>
        {recent.slice(0, 15).map((s) => (
          <div key={s.id} className="list-item small">
            <span className="muted">{timeFmt(s.occurredAt)}</span>
            <span className="grow" style={{ textDecoration: s.voided ? 'line-through' : undefined }}>
              {money(s.total)}
            </span>
            <button className="small ghost" onClick={() => print(s)} title={t('pos.printTicket')}>
              🖨
            </button>
            {!s.voided && (
              <button className="small danger" onClick={() => void voidSale(s)}>
                {t('pos.voidSale')}
              </button>
            )}
          </div>
        ))}
      </div>

      {weightFor && (
        <WeightModal
          product={weightFor}
          onClose={() => (setWeightFor(null), focus())}
          onOk={(w) => {
            add(weightFor, w);
            setWeightFor(null);
          }}
        />
      )}
      {paying && !ph && <PayModal total={total} onClose={() => (setPaying(false), focus())} onConfirm={confirmSale} />}
      {paying && ph && rate && (
        <PhonePayModal total={total} rate={rate} ph={ph} customer={customer} settings={store!.settings} onClose={() => (setPaying(false), focus())} onConfirm={(r) => void confirmSale(r.payments, r.changeArs + r.changeUsd * rate, r)} />
      )}
      {paying && ph && !rate && (
        <Modal title="Falta el dólar" onClose={() => setPaying(false)}>
          <p>No hay cotización del dólar cargada. El dueño la pone en Ajustes (o se baja sola con internet).</p>
        </Modal>
      )}
      {unitFor && ph && <UnitPicker ph={ph} productId={unitFor} onPick={addSerial} onClose={() => (setUnitFor(null), focus())} />}
      {phModal === 'customer' && ph && <CustomerModal ph={ph} onPick={(c) => (setCustomer(c), setPhModal(null), focus())} onClose={() => (setPhModal(null), focus())} />}
      {phModal === 'deposit' && ph && rate && store && (
        <DepositModal ph={ph} rate={rate} session={session} cashier={cashier} settings={store.settings} customer={customer} onClose={() => (setPhModal(null), focus())} onDone={() => (setPhModal(null), void loadSide(), focus())} />
      )}
      {phModal === 'repair' && ph && (
        <RepairChargeModal
          ph={ph}
          rate={rate ?? 0}
          onClose={() => (setPhModal(null), focus())}
          onPick={(r, ars) => {
            if (items.some((x) => x.repairOrderId === r.id)) return toast('Ya está en la venta');
            setItems((prev) => [...prev, { productId: ph.repairProductId, name: `Reparación #${r.number}`, unit: 'UNIT', qty: 1, listPrice: ars, repairOrderId: r.id, detail: r.device }]);
            if (!customer) {
              const c = ph.customers.find((x) => x.id === r.customerId);
              setCustomer(c ?? { id: r.customerId, name: r.customer });
            }
            setPhModal(null);
            focus();
          }}
        />
      )}
      {phModal === 'tradein' && ph && rate && <PayTradeInModal ph={ph} rate={rate} session={session} cashier={cashier} onClose={() => (setPhModal(null), void loadSide(), focus())} />}
      {phModal === 'courier' && ph && <CourierModal ph={ph} session={session} cashier={cashier} onClose={() => (setPhModal(null), void loadSide(), focus())} />}
      {done && (
        <Modal title={t('pos.saleDone')} onClose={() => (setDone(null), focus())}>
          <div className="stack">
            <div className="pos-total">{money(done.total)}</div>
            {done.change > 0 && (
              <div className="pos-total" style={{ color: 'var(--ok)' }}>
                {t('pos.change')}: {done.changeUsd ? usd(done.changeUsd) : money(done.change)}
              </div>
            )}
            <button onClick={() => print(done)}>🖨 {t('pos.printTicket')}</button>
            <button className="primary big" autoFocus onClick={() => (setDone(null), focus())}>
              {t('pos.newSale')}
            </button>
          </div>
        </Modal>
      )}
      {closing && <CloseCash phones={props.phones} session={session} cashier={cashier} recent={recent} onClose={() => setClosing(false)} onClosed={props.onClosed} />}
      {clocking && <ClockModal onClose={() => (setClocking(false), focus())} />}
      {moving && <CashMoveModal phones={props.phones} session={session} cashier={cashier} onClose={() => (setMoving(false), focus())} />}
      {printing && (props.phones ? <PhoneTicket sale={printing} store={store} /> : <Ticket sale={printing} store={store} />)}
    </div>
  );
}

function WeightModal({ product, onOk, onClose }: { product: CatalogProduct; onOk: (w: number) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [w, setW] = useState('');
  return (
    <Modal title={`${product.name} · ${money(product.price)}/kg`} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const n = toNum(w);
          if (n && n > 0) onOk(n);
        }}
      >
        <Field label={t('pos.weight')}>
          <input autoFocus inputMode="decimal" value={w} onChange={(e) => setW(e.target.value)} style={{ fontSize: '1.4rem' }} />
        </Field>
        <button className="primary big">{t('common.add')}</button>
      </form>
    </Modal>
  );
}

function PayModal({ total, onClose, onConfirm }: { total: number; onClose: () => void; onConfirm: (p: { method: PaymentMethod; amount: number }[], change: number) => void }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<{ method: PaymentMethod; amount: string }[]>([{ method: 'CASH', amount: String(total) }]);
  const parsed = rows.map((r) => ({ method: r.method, amount: toNum(r.amount) ?? 0 }));
  const { payments, change, missing } = settlePayments(total, parsed);
  const setRow = (i: number, patch: Partial<{ method: PaymentMethod; amount: string }>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const bills = [...new Set([total, Math.ceil(total / 1000) * 1000, Math.ceil(total / 2000) * 2000, Math.ceil(total / 10000) * 10000])];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (missing <= 0) onConfirm(payments as { method: PaymentMethod; amount: number }[], change);
  };
  return (
    <Modal title={`${t('pos.pay')} ${money(total)}`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {rows.map((r, i) => (
          <div key={i} className="stack">
            <div className="row">
              {BASIC_PAYMENT_METHODS.map((m) => (
                <button type="button" key={m} className={`small ${r.method === m ? 'primary' : ''}`} onClick={() => setRow(i, { method: m })}>
                  {t(`pos.methods.${m}`)}
                </button>
              ))}
            </div>
            <Field label={r.method === 'CASH' ? t('pos.received') : t('common.total')}>
              <input autoFocus={i === 0} inputMode="decimal" value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} style={{ fontSize: '1.4rem' }} />
            </Field>
            {r.method === 'CASH' && i === 0 && (
              <div className="row">
                {bills.map((b) => (
                  <button type="button" key={b} className="small" onClick={() => setRow(i, { amount: String(b) })}>
                    {money(b)}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {missing > 0 && (
          <>
            <p className="warn">
              {t('pos.remaining')}: {money(missing)}
            </p>
            <button type="button" onClick={() => setRows([...rows, { method: 'DEBIT', amount: String(missing) }])}>
              + {t('pos.addPayment')}
            </button>
          </>
        )}
        {change > 0 && (
          <p className="pos-total" style={{ fontSize: '1.8rem', color: 'var(--ok)' }}>
            {t('pos.change')}: {money(change)}
          </p>
        )}
        <button className="primary big" disabled={missing > 0}>
          {t('pos.confirmSale')}
        </button>
      </form>
    </Modal>
  );
}

function CloseCash({ session, cashier, recent, onClose, onClosed, phones }: { session: CashSessionLocal; cashier: PosUser; recent: LocalSale[]; onClose: () => void; onClosed: () => void; phones?: boolean }) {
  const { t } = useTranslation();
  const [counted, setCounted] = useState('');
  const [countedUsd, setCountedUsd] = useState('');
  const [result, setResult] = useState<{ expected: number; counted: number; expectedUsd?: number; countedUsd?: number } | null>(null);
  const [moves, setMoves] = useState<CashMoveLocal[]>([]);
  const [deposits, setDeposits] = useState<{ currency: string; amount: number; fx?: number }[]>([]);
  useEffect(() => {
    void kvGet<CashMoveLocal[]>(`cashMoves:${session.id}`).then((m) => setMoves(m ?? []));
    void kvGet<{ currency: string; amount: number; fx?: number }[]>(`cashDeposits:${session.id}`).then((d) => setDeposits(d ?? []));
  }, [session.id]);
  const valid = recent.filter((s) => !s.voided);
  const cashSales = round2(valid.reduce((sum, s) => sum + (s.cashArs ?? s.payments.filter((p) => p.method === 'CASH' && p.currency !== 'USD').reduce((a, p) => a + p.amount, 0)), 0));
  const ars = moves.filter((m) => m.currency !== 'USD');
  const out = round2(ars.filter((m) => cashMoveSign(m.kind) < 0).reduce((s, m) => s + m.amount, 0));
  const inflow = round2(ars.filter((m) => cashMoveSign(m.kind) > 0).reduce((s, m) => s + m.amount, 0));
  const depArs = round2(deposits.filter((d) => d.currency !== 'USD').reduce((s, d) => s + d.amount, 0));
  // Esperado = inicial + ventas en efectivo − pagos/gastos/retiros + cambio agregado (+ señas en efectivo).
  const expected = round2(session.openingAmount + cashSales - out + inflow + depArs);
  // Cajón de dólares (casa de celulares).
  const usdMoves = round2(moves.filter((m) => m.currency === 'USD').reduce((s, m) => s + cashMoveSign(m.kind) * m.amount, 0));
  const usdSales = round2(valid.reduce((s, x) => s + (x.cashUsd ?? 0), 0));
  const usdDeps = round2(deposits.filter((d) => d.currency === 'USD').reduce((s, d) => s + (d.fx ?? 0), 0));
  const expectedUsd = round2((session.openingUsd ?? 0) + usdSales + usdMoves + usdDeps);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const c = toNum(counted) ?? 0;
    const cu = toNum(countedUsd) ?? 0;
    await enqueue({ id: uuid(), type: 'CASH_CLOSE', userId: cashier.id, occurredAt: nowIso(), cashSessionId: session.id, countedAmount: c, ...(phones ? { countedUsd: cu } : {}) });
    await kvDel('cashSession');
    await kvDel(`cashMoves:${session.id}`);
    await kvDel(`cashDeposits:${session.id}`);
    setResult({ expected, counted: c, ...(phones ? { expectedUsd, countedUsd: cu } : {}) });
  };
  if (result) {
    const diff = round2(result.counted - result.expected);
    return (
      <Modal title={t('pos.cashClosed')} onClose={onClosed}>
        <div className="stack">
          <p>
            {t('pos.expected')}: <strong>{money(result.expected)}</strong>
          </p>
          <p>
            {t('pos.countedAmount')}: <strong>{money(result.counted)}</strong>
          </p>
          <p className={diff === 0 ? 'ok' : 'error'}>
            {t('pos.difference')}: <strong>{money(diff)}</strong>
          </p>
          {result.expectedUsd != null && (
            <p className={round2(result.countedUsd! - result.expectedUsd) === 0 ? 'ok' : 'error'}>
              Dólares: esperado {usd(result.expectedUsd)} · contado {usd(result.countedUsd)} · diferencia <strong>{usd(round2(result.countedUsd! - result.expectedUsd))}</strong>
            </p>
          )}
          <button className="primary" onClick={onClosed}>
            {t('common.close')}
          </button>
        </div>
      </Modal>
    );
  }
  return (
    <Modal title={t('pos.closeCash')} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <table className="small">
          <tbody>
            <tr>
              <td>{t('pos.openingAmount')}</td>
              <td className="num">{money(session.openingAmount)}</td>
            </tr>
            <tr>
              <td>+ {t('pos.cashSales')}</td>
              <td className="num">{money(cashSales)}</td>
            </tr>
            {out > 0 && (
              <tr>
                <td>− {t('pos.moveOut')}</td>
                <td className="num">{money(out)}</td>
              </tr>
            )}
            {inflow > 0 && (
              <tr>
                <td>+ {t('pos.moveKinds.DEPOSIT')}</td>
                <td className="num">{money(inflow)}</td>
              </tr>
            )}
            {depArs > 0 && (
              <tr>
                <td>+ Señas en efectivo</td>
                <td className="num">{money(depArs)}</td>
              </tr>
            )}
            <tr>
              <th>{t('pos.expected')}</th>
              <th className="num">{money(expected)}</th>
            </tr>
            {phones && (
              <tr>
                <th>Dólares esperados</th>
                <th className="num">{usd(expectedUsd)}</th>
              </tr>
            )}
          </tbody>
        </table>
        <Field label={t('pos.countedAmount')}>
          <input autoFocus inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} style={{ fontSize: '1.4rem' }} required />
        </Field>
        {phones && (
          <Field label="Dólares contados">
            <input inputMode="decimal" value={countedUsd} onChange={(e) => setCountedUsd(e.target.value)} style={{ fontSize: '1.4rem' }} required />
          </Field>
        )}
        <button className="primary big">{t('pos.closeCash')}</button>
      </form>
    </Modal>
  );
}

function Ticket({ sale, store }: { sale: LocalSale; store: StoreInfo | null }) {
  // El ticket es para el cliente: siempre en español, aunque la caja esté en chino.
  const { t } = useTranslation(undefined, { lng: 'es' });
  return (
    <div className="print-area ticket print-only">
      <div style={{ textAlign: 'center', fontWeight: 700 }}>{store?.name}</div>
      <div>{new Date(sale.occurredAt).toLocaleString('es-AR')}</div>
      <div>#{sale.id.slice(0, 8)}</div>
      <hr />
      {sale.lines.map((l, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span>
            {qtyFmt(l.qty)} {l.name}
            {l.offer ? ' *' : ''}
          </span>
          <span>{money(l.lineTotal)}</span>
        </div>
      ))}
      <hr />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
        <span>{t('common.total')}</span>
        <span>{money(sale.total)}</span>
      </div>
      {sale.payments.map((p, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{t(`pos.methods.${p.method}`)}</span>
          <span>{money(p.amount)}</span>
        </div>
      ))}
      {sale.change > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{t('pos.change')}</span>
          <span>{money(sale.change)}</span>
        </div>
      )}
      <hr />
      <div style={{ textAlign: 'center' }}>{t('pos.ticketFooter')}</div>
    </div>
  );
}
